import type { LogLike, ReceiptLike } from "@ancsure/shared";
import type { TxLike } from "@ancsure/ethereum";
import { SWAP_EVENT_TOPIC } from "@ancsure/ethereum";

// Canonical addresses (constants; no RPC needed)
export const TOKEN0 = "0x1111111111111111111111111111111111111111"; // "A"
export const TOKEN1 = "0x2222222222222222222222222222222222222222"; // "B"
export const PAIR = "0x3333333333333333333333333333333333333333"; // pair(TOKEN0, TOKEN1)
export const PAIR2 = "0x4444444444444444444444444444444444444444"; // different pool
export const ATTACKER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const OTHER_USER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const VICTIM = "0xcccccccccccccccccccccccccccccccccccccccc";

const addrTopic = (a: string) => "0x" + a.slice(2).toLowerCase().padStart(64, "0");

/**
 * Encode a V2 Swap event log. direction A_TO_B => amount0In>0, amount1Out>0.
 */
export function swapLog(
  pair: string,
  dir: "A_TO_B" | "B_TO_A",
  opts: { sender?: string; to?: string } = {},
): LogLike {
  const amt = (n: bigint) => n.toString(16).padStart(64, "0");
  const zero = "0".repeat(64);
  const data =
    dir === "A_TO_B"
      ? "0x" + amt(1000n) + zero + zero + amt(900n)
      : "0x" + zero + amt(1000n) + amt(900n) + zero;
  return {
    address: pair,
    topics: [SWAP_EVENT_TOPIC, addrTopic(opts.sender ?? ATTACKER), addrTopic(opts.to ?? ATTACKER)],
    data,
    logIndex: 0,
  };
}

let nonceCounter = 100;
function hash(): string {
  return "0x" + (nonceCounter++).toString(16).padStart(64, "0");
}

export function makeTx(from: string, overrides: Partial<TxLike> = {}): TxLike {
  return {
    hash: hash(),
    blockNumber: 12345678,
    transactionIndex: nonceCounter % 5,
    from,
    to: PAIR,
    value: 0n,
    input: "0x",
    ...overrides,
  };
}

export function makeReceipt(logs: LogLike[], status = 1): ReceiptLike {
  return { status, transactionHash: hash(), logs };
}

/** Convenience: a successful A_TO_B swap on PAIR by `from`. */
export function swapTx(
  from: string,
  dir: "A_TO_B" | "B_TO_A",
  index: number,
  opts: { pair?: string; status?: number; logs?: LogLike[] } = {},
): { tx: TxLike; receipt: ReceiptLike } {
  return {
    tx: makeTx(from, { transactionIndex: index, to: opts.pair ?? PAIR }),
    receipt: makeReceipt(
      opts.logs ?? [swapLog(opts.pair ?? PAIR, dir)],
      opts.status ?? 1,
    ),
  };
}
