import { Interface } from "ethers";
import type { DecodedSwapEvent, DecodedTransferEvent } from "@ancsure/shared";
import type { LogLike } from "@ancsure/shared";

/**
 * Uniswap V2 Pair Swap event — exact signature from official
 * v2-core contracts/UniswapV2Pair.sol:
 *   Swap(indexed address sender, uint amount0In, uint amount1In,
 *        uint amount0Out, uint amount1Out, indexed address to)
 */
export const SWAP_EVENT_TOPIC =
  "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";

export const SWAP_IFACE = new Interface([
  "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
]);

/** ERC-20 Transfer — Transfer(indexed address from, indexed address to, uint256 value) */
export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export const TRANSFER_IFACE = new Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export function decodeSwapEvents(
  logs: LogLike[],
  pairAddresses: Set<string>,
): DecodedSwapEvent[] {
  const out: DecodedSwapEvent[] = [];
  for (const log of logs) {
    if (
      log.topics[0]?.toLowerCase() === SWAP_EVENT_TOPIC &&
      pairAddresses.has(log.address.toLowerCase())
    ) {
      try {
        const parsed = SWAP_IFACE.parseLog({ topics: [...log.topics], data: log.data });
        if (!parsed) continue;
        out.push({
          pairAddress: log.address.toLowerCase(),
          sender: parsed.args.sender,
          to: parsed.args.to,
          amount0In: BigInt(parsed.args.amount0In),
          amount1In: BigInt(parsed.args.amount1In),
          amount0Out: BigInt(parsed.args.amount0Out),
          amount1Out: BigInt(parsed.args.amount1Out),
          // ethers v6 receipts expose `index` rather than `logIndex`
          logIndex: Number(log.logIndex ?? (log as unknown as { index?: number }).index ?? -1),
        });
      } catch {
        // malformed log; skip
      }
    }
  }
  return out.sort((a, b) => a.logIndex - b.logIndex);
}

export function decodeTransferEvents(logs: LogLike[]): DecodedTransferEvent[] {
  const out: DecodedTransferEvent[] = [];
  for (const log of logs) {
    if (log.topics[0]?.toLowerCase() === TRANSFER_TOPIC && log.topics.length === 3) {
      try {
        const parsed = TRANSFER_IFACE.parseLog({ topics: [...log.topics], data: log.data });
        if (!parsed) continue;
        out.push({
          tokenAddress: log.address.toLowerCase(),
          from: parsed.args.from,
          to: parsed.args.to,
          value: BigInt(parsed.args.value),
          logIndex: log.logIndex,
        });
      } catch {
        // skip
      }
    }
  }
  return out.sort((a, b) => a.logIndex - b.logIndex);
}

/**
 * INFERRED: swap direction relative to a pair's token ordering.
 * Uses the Swap event amounts directly (authoritative for V2):
 * - tokens flowing INTO the pool (amountXIn > 0) are what the trader sold.
 * Direction is expressed as A_TO_B meaning token0 -> token1.
 */
export function inferDirection(swap: DecodedSwapEvent): "A_TO_B" | "B_TO_A" | "UNKNOWN" {
  if (swap.amount0In > 0n && swap.amount1Out > 0n) return "A_TO_B"; // sold token0, bought token1
  if (swap.amount1In > 0n && swap.amount0Out > 0n) return "B_TO_A"; // sold token1, bought token0
  return "UNKNOWN";
}
