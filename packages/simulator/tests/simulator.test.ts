import { describe, it, expect } from "vitest";
import { getAmountOut, applySwapTo, SYNC_TOPIC } from "@ancsure/simulator";
import { simulateSandwich } from "@ancsure/simulator";
import type { DetectionResult, TransactionEvidence, DecodedSwapEvent } from "@ancsure/shared";

const PAIR = "0x" + "33".repeat(20);
const ATTACKER = "0x" + "aa".repeat(20);
const VICTIM = "0x" + "cc".repeat(20);
const ROUTER = "0x" + "11".repeat(20);

// Synthetic block state: tx3 front-run sells token1 in; tx4 victim sells token1.
const PRE = { reserve0: 500_000n * 10n ** 18n, reserve1: 300_000n * 10n ** 18n };
const FRONT_IN = 50_000n * 10n ** 18n;
const frontOut = getAmountOut(FRONT_IN, PRE.reserve1, PRE.reserve0);
const POST_FRONT = applySwapTo(PRE, 0n, FRONT_IN, frontOut, 0n);
const VICTIM_IN = 3_000n * 10n ** 18n;
const withAttackOut = getAmountOut(VICTIM_IN, POST_FRONT.reserve1, POST_FRONT.reserve0);
const counterfactualOut = getAmountOut(VICTIM_IN, PRE.reserve1, PRE.reserve0);

function mkEv(
  hash: string,
  txIndex: number,
  from: string,
  swap: Omit<DecodedSwapEvent, "sender" | "to"> | null,
): TransactionEvidence {
  // Swap event sits right after its tx's Sync: logIndex = txIndex*10 + 1.
  return {
    hash,
    blockNumber: 100,
    transactionIndex: txIndex,
    from,
    to: ROUTER,
    value: 0n,
    input: "0x",
    status: 1,
    logs: [],
    swapEvents: swap ? [{ ...swap, sender: ROUTER, to: from, logIndex: txIndex * 10 + 1 }] : [],
    transferEvents: [],
    pairs: new Map(),
    directions: new Map(),
  };
}

describe("v2-math", () => {
  it("getAmountOut matches the official formula on a known vector", () => {
    // classic example: 1 ETH into 100/100000 pool
    expect(getAmountOut(10n ** 18n, 100n * 10n ** 18n, 100000n * 10n ** 18n)).toBe(
      ((10n ** 18n * 997n) * (100000n * 10n ** 18n)) / (100n * 10n ** 18n * 1000n + 10n ** 18n * 997n),
    );
    expect(() => getAmountOut(0n, 1n, 1n)).toThrow();
  });

  it("applySwapTo is invertible", () => {
    const r = { reserve0: 500_000n * 10n ** 18n, reserve1: 300_000n * 10n ** 18n };
    const after = applySwapTo(r, 0n, FRONT_IN, frontOut, 0n);
    // reverseSwap semantics: subtract ins, add back outs
    const back = {
      reserve0: after.reserve0 - 0n + frontOut,
      reserve1: after.reserve1 - FRONT_IN + 0n,
    };
    expect(back).toEqual(r);
  });
});

describe("simulateSandwich (in-memory provider)", () => {
  // Sync inside each tx carries post-swap reserves and precedes its Swap log
  // (UniswapV2Pair emits Sync before Swap). Mock logIndexes follow that order:
  // sync at txIdx*10, swap at txIdx*10+1.

  function makeProvider() {
    const syncs = new Map<number, string>();
    const enc = (r0: bigint, r1: bigint) =>
      "0x" +
      r0.toString(16).padStart(64, "0") +
      r1.toString(16).padStart(64, "0");
    syncs.set(3, enc(POST_FRONT.reserve0, POST_FRONT.reserve1)); // front-run's own sync
    syncs.set(4, enc(0n, 0n)); // victim sync (unused for reconstruction)
    return {
      async send(method: string, params: unknown[]) {
        if (method !== "eth_getLogs") throw new Error("unexpected " + method);
        const filter = params[0] as { address: string; topics: string[]; fromBlock: string };
        if (filter.address.toLowerCase() !== PAIR.toLowerCase()) return [];
        if (parseInt(filter.fromBlock, 16) !== 100) return []; // only attack block has syncs
        const out: unknown[] = [];
        for (const [txIdx, data] of [...syncs].sort((a, b) => b[0] - a[0])) {
          out.push({
            topics: [SYNC_TOPIC],
            data,
            logIndex: "0x" + (txIdx * 10).toString(16),
            transactionIndex: "0x" + txIdx.toString(16),
          });
        }
        return out;
      },
    };
  }

  it("reproduces victim output exactly and computes counterfactual loss", async () => {
    const provider = makeProvider();
    const result: DetectionResult = {
      classification: "SANDWICH",
      victimTx: "0x04",
      frontRunTx: "0x03",
      backRunTx: "0x05",
      victims: [
        {
          hash: "0x04",
          transactionIndex: 4,
          from: VICTIM,
          status: 1,
          pairsSwapped: [{ pair: PAIR, direction: "B_TO_A" }],
        },
      ],
      blockNumber: 100,
      pairs: [PAIR],
      pair: PAIR,
      attacker: ATTACKER,
      rules: [],
      explanation: "",
    };

    const evidence = new Map<string, TransactionEvidence>([
      [
        "0x03",
        mkEv("0x03", 3, ATTACKER, {
          pairAddress: PAIR,
          amount0In: 0n,
          amount1In: FRONT_IN,
          amount0Out: frontOut,
          amount1Out: 0n,
        }),
      ],
      [
        "0x04",
        mkEv("0x04", 4, VICTIM, {
          pairAddress: PAIR,
          amount0In: 0n,
          amount1In: VICTIM_IN,
          amount0Out: withAttackOut,
          amount1Out: 0n,
        }),
      ],
    ]);

    const report = await simulateSandwich(provider, result, evidence, 3);
    expect(report.notes).toEqual([]);
    const leg = report.victims[0].legs[0];
    expect(leg.exactMatch).toBe(true);
    expect(leg.simulatedOutputWithAttack).toBe(withAttackOut);
    expect(leg.counterfactualOutput).toBe(counterfactualOut);
    expect(leg.loss).toBe(counterfactualOut - withAttackOut);
    expect(report.victims[0].reservesPreFrontRun[PAIR]).toEqual(PRE);
  });

  it("flags mismatch when actual output deviates from simulation", async () => {
    const provider = makeProvider();
    const result: DetectionResult = {
      classification: "SANDWICH",
      victimTx: "0x04",
      frontRunTx: "0x03",
      backRunTx: null,
      victims: [
        {
          hash: "0x04",
          transactionIndex: 4,
          from: VICTIM,
          status: 1,
          pairsSwapped: [{ pair: PAIR, direction: "B_TO_A" }],
        },
      ],
      blockNumber: 100,
      pairs: [PAIR],
      pair: PAIR,
      attacker: ATTACKER,
      rules: [],
      explanation: "",
    };
    // Corrupt the observed output by +1 wei -> mismatch expected.
    const evidence = new Map<string, TransactionEvidence>([
      [
        "0x03",
        mkEv("0x03", 3, ATTACKER, {
          pairAddress: PAIR,
          amount0In: 0n,
          amount1In: FRONT_IN,
          amount0Out: frontOut,
          amount1Out: 0n,
        }),
      ],
      [
        "0x04",
        mkEv("0x04", 4, VICTIM, {
          pairAddress: PAIR,
          amount0In: 0n,
          amount1In: VICTIM_IN,
          amount0Out: withAttackOut + 1n,
          amount1Out: 0n,
        }),
      ],
    ]);
    const report = await simulateSandwich(provider, result, evidence, 3);
    const leg = report.victims[0].legs[0];
    expect(leg.exactMatch).toBe(false);
    expect(leg.mismatchBasisPoints).toBe("0");
  });
});
