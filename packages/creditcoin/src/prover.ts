/**
 * On-chain verification against the BlockProver precompile (0x…0FD2).
 *
 * verifySingle()/verifyBatch() are static eth_calls (no gas); the *Emit* variants
 * persist verification on Creditcoin and are used when the claim authorization
 * trail must live on-chain. Proven API surface per USC SDK examples.
 */
import { ethers } from "ethers";
import { blockProver } from "@gluwa/usc-sdk";
import type { ContinuityResponse } from "@gluwa/usc-sdk/dist/proof-provider";
import { getCreditcoinProvider } from "./chains.js";

export { BLOCK_PROVER_PRECOMPILE_ADDRESS } from "@gluwa/usc-sdk/dist/block-prover";

export function getBlockProver(): blockProver.PrecompileBlockProver {
  return new blockProver.PrecompileBlockProver(getCreditcoinProvider());
}

export interface SingleVerification {
  txHash: string;
  height: number;
  txIndex: number;
  valid: boolean;
}

/** Compute index and statically verify one proof (free call, no signer needed). */
export async function verifySingleStatic(proofData: ContinuityResponse): Promise<SingleVerification> {
  const prover = getBlockProver();
  const txIndex = await prover.computeTransactionIndex(proofData.merkleProof);
  const valid = await prover.verifySingle(
    proofData.chainKey,
    proofData.headerNumber,
    proofData.txBytes,
    proofData.merkleProof,
    proofData.continuityProof,
  );
  return { txHash: proofData.txHash, height: proofData.headerNumber, txIndex, valid };
}

/** Verify and EMIT on Creditcoin — requires a funded Creditcoin signer. */
export async function verifySingleOnChain(
  proofData: ContinuityResponse,
): Promise<{ txHash: string; receiptHash: string }> {
  const pk = process.env.CREDITCOIN_PRIVATE_KEY;
  if (!pk) throw new Error("CREDITCOIN_PRIVATE_KEY is not set");
  const provider = getCreditcoinProvider();
  const signer = new ethers.Wallet(pk.startsWith("0x") ? pk : "0x" + pk, provider);
  const prover = getBlockProver();
  const tx = await prover.verifyAndEmitSingle(
    signer,
    proofData.chainKey,
    proofData.headerNumber,
    proofData.txBytes,
    proofData.merkleProof,
    proofData.continuityProof,
  );
  const rcpt = await tx.wait();
  return { txHash: proofData.txHash, receiptHash: rcpt?.hash ?? tx.hash };
}
