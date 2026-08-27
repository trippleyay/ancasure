/**
 * Proven verification pipeline (port of the validated MEVdetector USC flow).
 *
 * Steps per transaction hash, exactly as exercised in the successful demo:
 *  1. ProofBuilder.getProof(txHash) against the CC3 testnet proving service —
 *     returns headerNumber (block height), txBytes and merkle + continuity proofs.
 *  2. PrecompileBlockProver.verifySingle() read call on the Creditcoin precompile.
 *  3. Decode of the encoded bytes[] into normalized transaction/receipt fields,
 *     exposing Swap/Sync/Transfer topics for the downstream decoder.
 */
import { ethers } from "ethers";
import { resolveChainConfig, creditcoinRpc, DEFAULT_PROVER_URL } from "./index.js";

// USC SDK is CJS with namespaced module exports.
/* eslint-disable @typescript-eslint/no-var-requires */
const usc = require("@gluwa/usc-sdk");
const proofProvider = usc.proofProvider;
const blockProverMod = usc.blockProver;
const encoding = usc.encoding;

export interface VerifyOptions {
  /** Sepolia/Mainnet RPC — used to fetch tx+receipt for canonical encoding. */
  sourceRpcUrl?: string;
}

/**
 * Verifies a set of source-chain transaction hashes on Creditcoin.
 * Returns per-tx outcomes; NEVER throws for individual tx failures —
 * callers inspect `failures` to decide claim eligibility.
 */
export async function verifyTransactions(
  txHashes: string[],
  chain: string,
  opts: VerifyOptions = {},
): Promise<import("./index.js").VerifyOutcome> {
  const cfg = resolveChainConfig(chain);
  const ccRpc = new ethers.JsonRpcProvider(creditcoinRpc());
  const prover = new blockProverMod.PrecompileBlockProver(ccRpc);

  const { ProofBuilder } = proofProvider.service;

  const proven: import("./index.js").VerifiedTxEvidence[] = [];
  const failures: Array<{ txHash: string; error: string }> = [];

  // Batch first when possible: same-block transactions share a continuity proof.
  for (const txHash of txHashes) {
    try {
      const builder = new ProofBuilder(cfg.chainKey, DEFAULT_PROVER_URL);
      const proofResult = await builder.getProof(txHash);
      if (!proofResult.success || !proofResult.data) {
        throw new Error(proofResult.error ?? "proof generation failed");
      }
      const d = proofResult.data;

      const verified: boolean = await prover.verifySingle(
        d.chainKey ?? cfg.chainKey,
        d.headerNumber,
        d.txBytes,
        d.merkleProof,
        d.continuityProof,
      );
      if (!verified) throw new Error("precompile verifySingle returned false");

      proven.push({
        txHash,
        chainKey: cfg.chainKey,
        height: Number(d.headerNumber),
        verifiedOnChain: true,
      });
    } catch (e) {
      failures.push({ txHash, error: (e as Error).message ?? String(e) });
    }
  }
  return { proven, failures };
}
