/**
 * Evidence normalization — turns verified proof data into typed, decoded logs.
 *
 * Flow (per product spec): Ethereum tx/receipt -> abiEncode -> (proof verified
 * by prover.ts) -> decoder -> NormalizedEvidence. Decoding itself reuses the
 * PROVEN @ancsure/ethereum Swap/Sync decoder so evidence is byte-compatible
 * with what the detector consumed during validation.
 */
import { ethers } from "ethers";
import { encoding } from "@gluwa/usc-sdk";
import type { TransactionWithRaw } from "@gluwa/usc-sdk/dist/encoding/common";
import {
  decodeSwapEvents,
  decodeTransferEvents,
  SWAP_EVENT_TOPIC as SWAP_TOPIC,
} from "@ancsure/ethereum";
import type { LogLike, ReceiptLike } from "@ancsure/shared";

export interface NormalizedEvidence {
  chain: string;
  txHash: string;
  blockNumber: number;
  transactionIndex: number;
  from: string;
  to: string | null;
  encodedTypes: string[];
  swapEvents: ReturnType<typeof decodeSwapEvents>;
  transferEvents: ReturnType<typeof decodeTransferEvents>;
  /** Raw ABI-encoded bytes[] from abiEncode — attachable to the USDCDecoder pattern on-chain. */
  abiEncoded: string;
}

export async function normalizeVerifiedTransaction(
  chain: string,
  provider: ethers.Provider,
  txHash: string,
): Promise<NormalizedEvidence> {
  const [txRaw, rcpt] = await Promise.all([
    provider.getTransaction(txHash),
    provider.getTransactionReceipt(txHash),
  ]);
  if (!txRaw || !rcpt || rcpt.blockNumber === null) throw new Error(`tx ${txHash} unavailable`);
  const rawByHash = (await (provider as unknown as {
    send(method: string, params: unknown[]): Promise<unknown>;
  }).send("eth_getTransactionByHash", [txHash])) as {
    from?: string;
    input?: string;
    index?: string;
    transactionIndex?: string;
  } | null;

  const transactionIndex =
    rawByHash?.index !== undefined
      ? parseInt(rawByHash.index, 16)
      : Number(rcpt.index ?? 0);

  const txForEncode = {
    ...(txRaw.toJSON() as object),
    from: rawByHash?.from ?? txRaw.from,
    input: rawByHash?.input ?? txRaw.data,
    raw: (txRaw as unknown as { serialized?: string }).serialized,
    type: txRaw.type,
  } as unknown as TransactionWithRaw;

  const enc = encoding.abiEncode(txForEncode, rcpt as never);

  const logs: LogLike[] = rcpt.logs.map((l) => ({
    address: l.address.toLowerCase(),
    topics: [...l.topics],
    data: l.data,
    logIndex: l.index,
  }));
  const pairAddresses = new Set(
    logs
      .filter((l) => l.topics[0]?.toLowerCase() === SWAP_TOPIC)
      .map((l) => l.address.toLowerCase()),
  );
  const pairLogs = logs.filter((l) => pairAddresses.has(l.address));

  return {
    chain,
    txHash,
    blockNumber: rcpt.blockNumber,
    transactionIndex,
    from: (rawByHash?.from ?? txRaw.from).toLowerCase(),
    to: txRaw.to ? txRaw.to.toLowerCase() : null,
    encodedTypes: enc.types,
    swapEvents: decodeSwapEvents(pairLogs, pairAddresses),
    transferEvents: decodeTransferEvents(logs),
    abiEncoded: enc.abi,
  };
}

/** Type-safe re-exports for downstream consumers. */
export type { ReceiptLike, LogLike } from "@ancsure/shared";
