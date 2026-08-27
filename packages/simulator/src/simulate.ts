import type { DetectionResult, TransactionEvidence } from "@ancsure/shared";
import {
  getReservesBefore,
  applySwapTo,
  getAmountOut,
  type Reserves,
} from "./reserve-reconstruction.js";

/**
 * Counterfactual-loss simulator for detected sandwiches.
 *
 * Per victim leg (victim swap on an attacked pool):
 *   1. reserves immediately before the front-run — read directly from the
 *      last pair Sync log positioned before the front-run's Swap log
 *      (OBSERVED evidence; see reserve-reconstruction.ts)
 *   2. replay the front-run's exact observed amounts onto those reserves
 *   3. simulate the victim's exact observed input on post-front-run state
 *   4. reset to pre-front-run reserves and simulate the victim alone
 *   5. loss = counterfactual_output - simulated_with_attack
 *   6. verification: replaying the front-run forward from pre-reserves must
 *      reproduce the victim-observed output exactly when we simulate on
 *      post-front-run state — reported per leg as exactMatch.
 */

export interface VictimLeg {
  pool: string;
  sellToken: "token0" | "token1";
  /** OBSERVED: victim input amount */
  inputAmount: bigint;
  /** OBSERVED: victim output amount from its real Swap event */
  actualOutput: bigint;
  /** SIMULATED: output on post-front-run reserves */
  simulatedOutputWithAttack: bigint;
  /** SIMULATED: output on pre-front-run reserves */
  counterfactualOutput: bigint;
  loss: bigint;
  exactMatch: boolean;
  mismatchBasisPoints?: string;
}

export interface VictimSimulation {
  victimTx: string;
  legs: VictimLeg[];
  totalLoss: bigint | null;
  reservesPreFrontRun: Record<string, Reserves>;
}

export interface SimulationReport {
  frontRunTx: string;
  backRunTx: string | null;
  attacker: string | null;
  blockNumber: number;
  pools: string[];
  victims: VictimSimulation[];
  notes: string[];
}

function bpsDiff(sim: bigint, actual: bigint): string | undefined {
  if (sim === actual) return undefined;
  if (actual === 0n) return "n/a";
  const d = sim > actual ? sim - actual : actual - sim;
  return ((d * 10000n) / actual).toString();
}

export async function simulateSandwich(
  provider: { send: (m: string, p: unknown[]) => Promise<unknown> },
  result: DetectionResult,
  evidence: Map<string, TransactionEvidence>,
  frontRunIndex: number,
): Promise<SimulationReport> {
  if (result.classification !== "SANDWICH") throw new Error("Not a SANDWICH classification");
  const notes: string[] = [];
  const pools = result.pairs ?? [];

  const frontEv = result.frontRunTx ? evidence.get(result.frontRunTx) : undefined;
  if (!frontEv) throw new Error("Missing front-run evidence");

  const victims: VictimSimulation[] = [];

  for (const v of result.victims) {
    const ev = evidence.get(v.hash);
    if (!ev) {
      notes.push(`Missing evidence for victim ${v.hash}; skipped`);
      continue;
    }

    const legs: VictimLeg[] = [];
    const preByPool: Record<string, Reserves> = {};

    for (const ps of v.pairsSwapped) {
      const pool = ps.pair;
      const victimSwap = ev.swapEvents.find(
        (s) => s.pairAddress.toLowerCase() === pool.toLowerCase(),
      );
      const frontSwap = frontEv.swapEvents.find(
        (s) => s.pairAddress.toLowerCase() === pool.toLowerCase(),
      );
      if (!victimSwap || !frontSwap) continue;

      const sellToken: "token0" | "token1" = ps.direction === "A_TO_B" ? "token0" : "token1";

      // 1. Pre-front-run reserves (OBSERVED via front-run's own post-state
      //    Sync + exact delta reversal). Anchor = the swap's own log so the
      //    lookup includes the front-run tx's Sync (which carries POST-swap
      //    reserves) and reverses the swap deltas from it.
      const anchor = { txIndex: frontRunIndex, logIndex: frontSwap.logIndex };
      let pre: Reserves;
      try {
        ({ reserves: pre } = await getReservesBefore(provider, pool, result.blockNumber, anchor, {
          amount0In: frontSwap.amount0In,
          amount1In: frontSwap.amount1In,
          amount0Out: frontSwap.amount0Out,
          amount1Out: frontSwap.amount1Out,
        }));
      } catch (e) {
        notes.push(`Reserve reconstruction failed for ${pool}: ${(e as Error).message}`);
        continue;
      }
      preByPool[pool] = pre;

      // 2. Replay front-run exactly.
      const postFront = applySwapTo(
        pre,
        frontSwap.amount0In,
        frontSwap.amount1In,
        frontSwap.amount0Out,
        frontSwap.amount1Out,
      );

      // 3+4. Simulate victim input in both states.
      const [rinPost, routPost] =
        sellToken === "token0"
          ? [postFront.reserve0, postFront.reserve1]
          : [postFront.reserve1, postFront.reserve0];
      const [rinPre, routPre] =
        sellToken === "token0"
          ? [pre.reserve0, pre.reserve1]
          : [pre.reserve1, pre.reserve0];

      const simulatedOutputWithAttack = getAmountOut(
        victimSwap.amount0In + victimSwap.amount1In > 0n
          ? sellToken === "token0"
            ? victimSwap.amount0In
            : victimSwap.amount1In
          : 0n,
        rinPost,
        routPost,
      );
      const counterfactualOutput = getAmountOut(
        sellToken === "token0" ? victimSwap.amount0In : victimSwap.amount1In,
        rinPre,
        routPre,
      );

      const inputAmount =
        sellToken === "token0" ? victimSwap.amount0In : victimSwap.amount1In;
      const actualOutput =
        sellToken === "token0" ? victimSwap.amount1Out : victimSwap.amount0Out;

      legs.push({
        pool,
        sellToken,
        inputAmount,
        actualOutput,
        simulatedOutputWithAttack,
        counterfactualOutput,
        loss: counterfactualOutput - simulatedOutputWithAttack,
        exactMatch: simulatedOutputWithAttack === actualOutput,
        mismatchBasisPoints: bpsDiff(simulatedOutputWithAttack, actualOutput),
      });
    }

    const totalLoss = legs.length === 1 ? legs[0].loss : null;
    if (legs.length === 0) notes.push(`No simulatable legs for victim ${v.hash}`);
    victims.push({ victimTx: v.hash, legs, totalLoss, reservesPreFrontRun: preByPool });
  }

  return {
    frontRunTx: result.frontRunTx ?? "unknown",
    backRunTx: result.backRunTx ?? "unknown",
    attacker: result.attacker,
    blockNumber: result.blockNumber,
    pools,
    victims,
    notes,
  };
}
