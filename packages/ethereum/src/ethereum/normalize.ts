import { Interface } from "ethers";
import type {
  PairMetadata,
  SwapDirection,
  TransactionEvidence,
} from "@ancsure/shared";
import type { LogLike, ReceiptLike } from "@ancsure/shared";
import { decodeSwapEvents, decodeTransferEvents, inferDirection } from "../decoder/decoder.js";
import type { UniswapV2Service } from "../uniswap/uniswap-v2-service.js";

/** Minimal tx shape. */
export interface TxLike {
  hash: string;
  blockNumber: number;
  transactionIndex: number;
  from: string;
  to: string | null;
  value?: bigint;
  input?: string;
}

/** Official Uniswap V2 Router02 (used only as an informational constant). */
export const ROUTER_V2 = "0x7a250d5630b4cf539739df2c5dacb4c659f2488d";

const ROUTER_IFACE = new Interface([
  "function swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)",
]);

/**
 * Normalize raw (tx, receipt) into TransactionEvidence.
 *
 * Pair identification strategy (INFERRED — see docs/rules.md):
 *   1. Any contract that emits a Swap event is treated as a pair.
 *   2. If the tx has no Swap events, fall back to parsing router calldata to
 *      extract the path tokens and derive pairs via the official factory.
 */
export async function normalizeTransaction(
  tx: TxLike,
  receipt: ReceiptLike | null,
  v2: UniswapV2Service | null,
): Promise<TransactionEvidence> {
  const logs: LogLike[] = receipt?.logs ?? [];
  const swapEvents = decodeSwapEvents(logs, new Set(logs.map((l) => l.address.toLowerCase())));

  const pairs = new Map<string, PairMetadata>();
  for (const se of swapEvents) {
    if (!pairs.has(se.pairAddress)) {
      const meta = v2 ? await v2.getPairMetadata(se.pairAddress) : null;
      pairs.set(
        se.pairAddress,
        meta ?? { pairAddress: se.pairAddress, token0: "UNKNOWN_TOKEN0", token1: "UNKNOWN_TOKEN1" },
      );
    }
  }

  if (pairs.size === 0 && v2) {
    await extractPairsFromCalldata(tx.input ?? "0x", pairs, v2);
  }

  const directions = new Map<string, SwapDirection>();
  for (const [addr, meta] of pairs) {
    const firstSwap = swapEvents.find((s) => s.pairAddress === addr);
    directions.set(
      addr,
      firstSwap ? inferDirection(firstSwap) : directionFromCalldata(tx.input ?? "0x", meta),
    );
  }

  return {
    hash: tx.hash.toLowerCase(),
    blockNumber: tx.blockNumber,
    transactionIndex: tx.transactionIndex,
    from: tx.from.toLowerCase(),
    to: tx.to ? tx.to.toLowerCase() : null,
    value: tx.value ?? 0n,
    input: tx.input ?? "0x",
    gasUsed: receipt?.gasUsed,
    effectiveGasPriceGwei: receipt?.effectiveGasPrice
      ? (Number(receipt.effectiveGasPrice) / 1e9).toFixed(3)
      : undefined,
    status: receipt?.status ?? -1,
    logs: [] as never as TransactionEvidence["logs"],
    swapEvents,
    transferEvents: decodeTransferEvents(logs),
    pairs,
    directions,
  };
}

async function extractPairsFromCalldata(
  input: string,
  pairs: Map<string, PairMetadata>,
  v2: UniswapV2Service,
): Promise<void> {
  try {
    const decoded = ROUTER_IFACE.parseTransaction({ data: input });
    const path = (decoded?.args.path ?? []) as string[];
    for (let i = 0; i + 1 < path.length; i++) {
      const pairAddr = await v2.getPairForTokens(path[i], path[i + 1]);
      if (pairAddr && !pairs.has(pairAddr)) {
        const meta = await v2.getPairMetadata(pairAddr);
        if (meta) pairs.set(pairAddr, meta);
      }
    }
  } catch {
    // not a recognized router call
  }
}

function directionFromCalldata(input: string, meta: PairMetadata): SwapDirection {
  try {
    const decoded = ROUTER_IFACE.parseTransaction({ data: input });
    const path = ((decoded?.args.path ?? []) as string[]).map((p) => p.toLowerCase());
    if (path.length >= 2) {
      if (path[0] === meta.token0 && path[path.length - 1] === meta.token1) return "A_TO_B";
      if (path[0] === meta.token1 && path[path.length - 1] === meta.token0) return "B_TO_A";
    }
  } catch {
    // fall through
  }
  return "UNKNOWN";
}
