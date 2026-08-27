import { ethers } from "ethers";

/**
 * Exact pre-front-run reserve reconstruction.
 *
 * V2 mechanics detail: inside UniswapV2Pair.swap(), _update() emits Sync
 * BEFORE the Swap event — and that Sync carries the POST-swap reserves.
 * Two cases:
 *
 *   A. Pair traded earlier in the attack block (typical): the last Sync at or
 *      before the front-run tx is the front-run's OWN sync (post-front-run
 *      state). Pre-front-run reserves = that Sync with the front-run's swap
 *      deltas reversed (reserve -= amountIn, += amountOut).
 *   B. Front-run is the pair's first activity in the block: the last Sync
 *      strictly before the front-run tx already IS the pre-front-run state;
 *      walk backwards in <=10-block windows if needed (Alchemy free tier caps
 *      eth_getLogs ranges).
 *
 * Validation (caller-side): applying the front-run swap forward to the result
 * must reproduce the Sync observed inside/after the front-run tx.
 */

export const SYNC_TOPIC = "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1";
export const SWAP_TOPIC = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";

const SYNC_IFACE = new ethers.Interface(["event Sync(uint112 reserve0, uint112 reserve1)"]);

export interface Reserves {
  reserve0: bigint;
  reserve1: bigint;
}

export interface LogPos {
  txIndex: number;
  logIndex: number;
}

type MinimalProvider = { send: (method: string, params: unknown[]) => Promise<unknown> };

interface PairLog {
  txIndex: number;
  logIndex: number;
  topic0: string;
  data: string;
}

export async function getPairLogs(
  provider: MinimalProvider,
  pairAddress: string,
  fromBlock: number,
  toBlock: number,
): Promise<PairLog[]> {
  const raw = (await provider.send("eth_getLogs", [
    {
      address: pairAddress,
      topics: [[SYNC_TOPIC, SWAP_TOPIC]],
      fromBlock: "0x" + fromBlock.toString(16),
      toBlock: "0x" + toBlock.toString(16),
    },
  ])) as Array<{
    topics: string[];
    data: string;
    transactionIndex?: string;
    logIndex: string;
  }>;
  return raw.map((l) => ({
    txIndex: l.transactionIndex !== undefined ? parseInt(l.transactionIndex, 16) : -1,
    logIndex: parseInt(l.logIndex, 16),
    topic0: l.topics[0],
    data: l.data,
  }));
}

export function decodeSyncReserves(data: string): Reserves | null {
  try {
    const parsed = SYNC_IFACE.parseLog({ topics: [SYNC_TOPIC], data });
    if (!parsed) return null;
    return { reserve0: BigInt(parsed.args.reserve0), reserve1: BigInt(parsed.args.reserve1) };
  } catch {
    return null;
  }
}

function posBefore(a: LogPos, b: LogPos): boolean {
  return a.txIndex < b.txIndex || (a.txIndex === b.txIndex && a.logIndex < b.logIndex);
}

/**
 * Reserves immediately BEFORE the log at `anchor` (front-run tx).
 * `anchorSwap` = front-run's swap amounts on this pair (needed to reverse
 * its own post-state Sync when the pair was idle before it in this block).
 */
export async function getReservesBefore(
  provider: MinimalProvider,
  pairAddress: string,
  anchorBlock: number,
  anchor: LogPos,
  anchorSwap: { amount0In: bigint; amount1In: bigint; amount0Out: bigint; amount1Out: bigint },
  maxLookbackBlocks = 7200,
): Promise<{ reserves: Reserves; source: "own-sync-reversed" | "prior-sync" }> {
  const logs = await getPairLogs(provider, pairAddress, anchorBlock, anchorBlock);
  const sortedSyncs = logs
    .filter((l) => l.topic0 === SYNC_TOPIC)
    .sort((a, b) => b.txIndex - a.txIndex || b.logIndex - a.logIndex); // newest first

  // Case A: last sync at-or-before anchor (i.e. the front-run's own sync).
  const own = sortedSyncs.find(
    (l) => l.txIndex < anchor.txIndex || (l.txIndex === anchor.txIndex && l.logIndex <= anchor.logIndex),
  );
  if (own && own.txIndex >= anchor.txIndex) {
    const r = decodeSyncReserves(own.data);
    if (r) {
      return {
        reserves: {
          reserve0: r.reserve0 - anchorSwap.amount0In + anchorSwap.amount0Out,
          reserve1: r.reserve1 - anchorSwap.amount1In + anchorSwap.amount1Out,
        },
        source: "own-sync-reversed",
      };
    }
  }

  // Case B: last sync strictly before anchor.
  const prior = sortedSyncs.find(
    (l) => l.txIndex < anchor.txIndex || (l.txIndex === anchor.txIndex && l.logIndex < anchor.logIndex),
  );
  if (prior) {
    const r = decodeSyncReserves(prior.data);
    if (r) return { reserves: r, source: "prior-sync" };
  }

  // Fallback: look backwards in <=10-block windows (free-tier range cap).
  const WINDOW = 10;
  for (let hi = anchorBlock - 1; hi > anchorBlock - maxLookbackBlocks; hi -= WINDOW) {
    const lo = Math.max(hi - WINDOW + 1, anchorBlock - maxLookbackBlocks);
    const past = await getPairLogs(provider, pairAddress, lo, hi);
    const syncs = past
      .filter((l) => l.topic0 === SYNC_TOPIC)
      .sort((a, b) => b.txIndex - a.txIndex || b.logIndex - a.logIndex);
    if (syncs.length) {
      const rr = decodeSyncReserves(syncs[0].data);
      if (rr) return { reserves: rr, source: "prior-sync" };
    }
  }
  throw new Error(`No prior Sync found for ${pairAddress} within ${maxLookbackBlocks} blocks`);
}

/** Apply a swap forward, V2-style (balance update semantics). */
export function applySwapTo(
  r: Reserves,
  amount0In: bigint,
  amount1In: bigint,
  amount0Out: bigint,
  amount1Out: bigint,
): Reserves {
  return {
    reserve0: r.reserve0 + amount0In - amount0Out,
    reserve1: r.reserve1 + amount1In - amount1Out,
  };
}

/** Official UniswapV2Library.getAmountOut. */
export function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n) throw new Error("INSUFFICIENT_INPUT_AMOUNT");
  if (reserveIn <= 0n || reserveOut <= 0n) throw new Error("INSUFFICIENT_LIQUIDITY");
  const amountInWithFee = amountIn * 997n;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * 1000n + amountInWithFee;
  return numerator / denominator;
}

/**
 * Ordered exact-input route through pools. Output of each hop feeds the next.
 */
export interface HopSpec {
  amountIn?: bigint; // required for first hop; chained afterwards
  sellToken: "token0" | "token1";
  reserves: Reserves;
}

export function simulateRoute(hops: HopSpec[]): bigint {
  let out = 0n;
  for (let i = 0; i < hops.length; i++) {
    const h = hops[i];
    const input = i === 0 ? h.amountIn! : out;
    if (input <= 0n) throw new Error("SIMULATION_ZERO_INPUT");
    const [rin, rout] =
      h.sellToken === "token0"
        ? [h.reserves.reserve0, h.reserves.reserve1]
        : [h.reserves.reserve1, h.reserves.reserve0];
    out = getAmountOut(input, rin, rout);
  }
  return out;
}
