/**
 * Counterfactual simulation service — thin orchestration over the PROVEN
 * detector + simulator cores (no new detection/simulation logic here).
 */
import { detectForTxHash } from "@ancsure/detector";
import { RpcClient, UniswapV2Service, normalizeTransaction } from "@ancsure/ethereum";
import { simulateSandwich } from "@ancsure/simulator";
import type { TransactionEvidence } from "@ancsure/shared";

export async function simulateAndSerialize(
  rpcUrl: string,
  victimTxHash: string,
): Promise<unknown> {
  const result = await detectForTxHash(rpcUrl, victimTxHash);
  if (result.classification !== "SANDWICH") {
    return { classification: "NOT_SANDWICH", explanation: result.explanation };
  }

  const rpc = new RpcClient(rpcUrl);
  const v2 = new UniswapV2Service(rpc.getProvider());

  const evidence = new Map<string, TransactionEvidence>();
  const hashes = [
    result.frontRunTx,
    ...result.victims.map((v) => v.hash),
    result.backRunTx,
  ].filter((h): h is string => !!h);

  let frontRunIndex = -1;
  for (const h of [...new Set(hashes)]) {
    const tx = await rpc.getTransaction(h);
    const receipt = await rpc.getTransactionReceipt(h);
    if (!tx || !receipt || tx.blockNumber === null) continue;
    const raw = (await rpc.getProvider().send("eth_getTransactionByHash", [h])) as {
      index?: string;
      transactionIndex?: string;
    } | null;
    const idx =
      raw?.index !== undefined
        ? parseInt(raw.index, 16)
        : raw?.transactionIndex !== undefined
          ? parseInt(raw.transactionIndex, 16)
          : undefined;
    if (idx === undefined) throw new Error(`No index for ${h}`);
    if (h === result.frontRunTx) frontRunIndex = idx;
    evidence.set(
      h,
      await normalizeTransaction(
        { ...(tx as object), blockNumber: tx.blockNumber as number, transactionIndex: idx } as never,
        receipt as never,
        v2,
      ),
    );
  }

  return simulateSandwich(rpc.getProvider(), result, evidence, frontRunIndex);
}
