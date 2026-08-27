import { RpcClient } from "@ancsure/ethereum";
import { UniswapV2Service } from "@ancsure/ethereum";
import { normalizeTransaction, type TxLike } from "@ancsure/ethereum";
import { detectSandwichRun } from "./detector.js";
import type { DetectionResult, TransactionEvidence } from "@ancsure/shared";

/**
 * Full pipeline: fetch the suspect tx + its block's transaction list, normalize
 * each tx lazily, and classify with the run-based (multi-victim) detector.
 */
export async function detectForTxHash(rpcUrl: string, hash: string): Promise<DetectionResult> {
  const rpc = new RpcClient(rpcUrl);
  const v2 = new UniswapV2Service(rpc.getProvider());

  const tx = await rpc.getTransaction(hash);
  if (!tx || tx.blockNumber === null) {
    throw new Error(`Transaction ${hash} not found or not mined`);
  }
  const receipt = await rpc.getTransactionReceipt(hash);

  // Resolve victim index (provider-dependent field name)
  const raw = (await rpc.getProvider().send("eth_getTransactionByHash", [hash])) as {
    index?: string;
    transactionIndex?: string;
    blockNumber?: string;
  } | null;
  const blockNumber = raw?.blockNumber
    ? parseInt(raw.blockNumber, 16)
    : (tx.blockNumber as number);
  const index =
    raw?.index !== undefined
      ? parseInt(raw.index, 16)
      : raw?.transactionIndex !== undefined
        ? parseInt(raw.transactionIndex, 16)
        : undefined;
  if (index === undefined) throw new Error(`Could not resolve transaction index for ${hash}`);

  // Lazy per-index fetcher: normalizes and caches evidence for any index in block.
  const cache = new Map<number, TransactionEvidence | null>();
  const getTx = async (i: number): Promise<TransactionEvidence | null> => {
    if (cache.has(i)) return cache.get(i)!;
    let ev: TransactionEvidence | null = null;
    if (i === index) {
      ev = await normalizeTransaction(
        { ...(tx as unknown as TxLike), blockNumber, transactionIndex: index },
        receipt as never,
        v2,
      );
    } else {
      const ntx = await rpc.getTransactionByBlockAndIndex(blockNumber, i);
      if (ntx) {
        const nreceipt = await rpc.getTransactionReceipt(ntx.hash);
        const nraw = (await rpc.getProvider().send("eth_getTransactionByHash", [ntx.hash])) as {
          index?: string;
          transactionIndex?: string;
          from?: string;
          input?: string;
        } | null;
        const nIdx =
          nraw?.index !== undefined
            ? parseInt(nraw.index, 16)
            : nraw?.transactionIndex !== undefined
              ? parseInt(nraw.transactionIndex, 16)
              : i;
        ev = await normalizeTransaction(
          {
            hash: ntx.hash,
            blockNumber,
            transactionIndex: nIdx,
            from: (nraw?.from ?? (ntx as unknown as TxLike).from).toLowerCase(),
            to: (ntx as unknown as TxLike).to ?? null,
            value: (ntx as unknown as TxLike).value ?? 0n,
            input: nraw?.input ?? (ntx as unknown as TxLike).input ?? "0x",
          },
          nreceipt as never,
          v2,
        );
      }
    }
    cache.set(i, ev);
    return ev;
  };

  return detectSandwichRun(blockNumber, index, getTx);
}
