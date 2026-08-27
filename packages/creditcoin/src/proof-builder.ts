/**
 * ProofBuilder wrapper — generates Merkle + continuity proofs for Ethereum
 * transactions via the USC proof-provider service (proven flow).
 */
import { proofProvider } from "@gluwa/usc-sdk";
import type { ProofResult, BatchProofResult } from "@gluwa/usc-sdk/dist/proof-provider";
import { resolveSourceChainKey } from "./chains.js";
import type { SourceChain } from "@ancsure/shared";

export const DEFAULT_PROVER_API_URL = "https://prover.cc3-testnet.creditcoin.network";

export function proverApiUrl(): string {
  return process.env.ATTESTCOIN_PROVER_URL ?? DEFAULT_PROVER_API_URL;
}

export interface TxProof extends ProofResult {
  /** Convenience echo of the requested hash. */
  transactionHash: string;
}

/** Build inclusion + continuity proofs for a single transaction. */
export async function buildProof(txHash: string, chain: SourceChain): Promise<TxProof> {
  const chainKey = await resolveSourceChainKey(chain);
  const builder = new proofProvider.service.ProofBuilder(chainKey, proverApiUrl());
  const res = await builder.getProof(txHash);
  return { ...res, transactionHash: txHash };
}

/** Build proofs for several transactions (independent prover calls, safe to parallelize upstream). */
export async function buildProofs(txHashes: string[], chain: SourceChain): Promise<TxProof[]> {
  return Promise.all(txHashes.map((h) => buildProof(h, chain)));
}

export type { ProofResult, BatchProofResult };
