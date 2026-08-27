/**
 * Creditcoin/Attestcoin verification service wrapper.
 * Delegates to the PROVEN USC-SDK flow inside packages/creditcoin.
 */
import { verifyTransactions } from "@ancsure/creditcoin";
import type { SourceChain } from "@ancsure/shared";

export async function verifyEvidence(txHashes: string[], chain: SourceChain) {
  if (!txHashes.length) throw new Error("txHashes must not be empty");
  for (const h of txHashes) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(h)) throw new Error(`bad tx hash ${h}`);
  }
  return verifyTransactions(txHashes, chain);
}
