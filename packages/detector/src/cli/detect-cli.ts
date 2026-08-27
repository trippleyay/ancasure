#!/usr/bin/env node
/**
 * CLI: detect sandwich for a victim transaction hash.
 *   ETHEREUM_RPC_URL=... npx tsx packages/detector/src/cli/detect-cli.ts 0x<hash> [chain]
 * chain: ethereum-mainnet | ethereum-sepolia (default: env DEFAULT_SOURCE_CHAIN or sepolia)
 */
import { detectForTxHash } from "../pipeline.js";
import { isSourceChain, loadDotEnv, rpcUrlFor, type SourceChain } from "@ancsure/shared";

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export async function main(): Promise<void> {
  const hash = process.argv[2];
  if (!hash || !HASH_RE.test(hash)) {
    console.error("Usage: npx tsx ...detect-cli.ts 0xTRANSACTION_HASH [chain]");
    process.exit(1);
  }
  const chainArg = process.argv[3] ?? process.env.DEFAULT_SOURCE_CHAIN ?? "ethereum-sepolia";
  if (!isSourceChain(chainArg)) {
    console.error(`Unsupported source chain: ${chainArg}`);
    process.exit(1);
  }
  const rpcUrl = rpcUrlFor(chainArg as SourceChain);
  try {
    const result = await detectForTxHash(rpcUrl, hash);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Detection failed:", (err as Error).message);
    process.exit(1);
  }
}

if (!process.env.ANCASURE_NO_CLI_MAIN && process.argv[1]?.endsWith("detect-cli.ts")) {
  loadDotEnv();
  main();
}
