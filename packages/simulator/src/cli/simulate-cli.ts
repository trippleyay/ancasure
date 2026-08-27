/**
 * CLI: counterfactual loss simulation for a victim transaction hash.
 *   npx tsx packages/simulator/src/cli/simulate-cli.ts 0x<hash> [chain]
 *
 * Runs the detector, reconstructs pre-front-run reserves and replays exact
 * observed amounts through official V2 math (proven logic — unchanged).
 */
import { detectForTxHash } from "@ancsure/detector";
import { RpcClient } from "@ancsure/ethereum";
import { normalizeTransaction } from "@ancsure/ethereum";
import { UniswapV2Service } from "@ancsure/ethereum";
import { simulateSandwich } from "../simulate.js";
import type { TransactionEvidence } from "@ancsure/shared";
import { isSourceChain, loadDotEnv, rpcUrlFor, type SourceChain } from "@ancsure/shared";

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export async function main(): Promise<void> {
  const hash = process.argv[2];
  if (!hash || !HASH_RE.test(hash)) {
    console.error("Usage: npx tsx ...simulate-cli.ts 0x<tx-hash> [chain]");
    process.exit(1);
  }
  const chainArg = process.argv[3] ?? process.env.DEFAULT_SOURCE_CHAIN ?? "ethereum-sepolia";
  if (!isSourceChain(chainArg)) {
    console.error(`Unsupported source chain: ${chainArg}`);
    process.exit(1);
  }
  const rpcUrl = rpcUrlFor(chainArg as SourceChain);

  const result = await detectForTxHash(rpcUrl, hash);
  if (result.classification !== "SANDWICH") {
    console.log(JSON.stringify({ classification: "NOT_SANDWICH", explanation: result.explanation }, null, 2));
    return;
  }

  // Re-fetch evidence for every tx in the run so the simulator has Swap events.
  const rpc = new RpcClient(rpcUrl);
  const v2 = new UniswapV2Service(rpc.getProvider());

  const evidence = new Map<string, TransactionEvidence>();
  const hashes = [result.frontRunTx, ...result.victims.map((v) => v.hash), result.backRunTx].filter(
    (h): h is string => !!h,
  );
  let frontRunIndex = -1;
  for (const h of [...new Set(hashes)]) {
    const tx = await rpc.getTransaction(h);
    const receipt = await rpc.getTransactionReceipt(h);
    if (!tx || !receipt || tx.blockNumber === null) continue;
    const raw = (await rpc.getProvider().send("eth_getTransactionByHash", [h])) as {
      index?: string;
      transactionIndex?: string;
    } | null;
    const idx = raw?.index !== undefined
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

  const report = await simulateSandwich(rpc.getProvider(), result, evidence, frontRunIndex);
  console.log(JSON.stringify(report, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

if (!process.env.ANCASURE_NO_CLI_MAIN && process.argv[1]?.endsWith("simulate-cli.ts")) {
  loadDotEnv();
  main().catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
}
