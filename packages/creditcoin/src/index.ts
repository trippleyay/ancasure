/**
 * Creditcoin / Attestcoin proof integration.
 *
 * Wraps the proven USC-SDK flow demonstrated during MEVdetector validation:
 *   Ethereum tx hash -> ProofBuilder.getProof() -> abiEncode(tx, receipt)
 *     -> PrecompileBlockProver.verifySingle() (on-chain precompile call)
 *     -> decode encoded bytes[] into normalized transaction/receipt evidence
 *
 * chainKey resolution per product spec: ethereum-mainnet and ethereum-sepolia
 * only. No BNB support is assumed.
 */
export const DEFAULT_PROVER_URL =
  process.env.CREDITCOIN_PROVER_URL ?? process.env.ATTESTCOIN_PROVER_URL ?? "https://prover.cc3-testnet.creditcoin.network";

export interface ChainConfig {
  chainKey: number;
  name: string;
}

/** Validated source chains on CC3 testnet (per AncaSure product spec). */
const CHAINS: Record<string, ChainConfig> = {
  "ethereum-mainnet": { chainKey: 2, name: "Ethereum Mainnet" },
  "ethereum-sepolia": { chainKey: 102, name: "Ethereum Sepolia" },
};

export function resolveChainConfig(chain: string): ChainConfig {
  const c = CHAINS[chain];
  if (!c) throw new Error(`unsupported chain for Creditcoin proving: ${chain}`);
  return c;
}

export function creditcoinRpc(): string {
  const url = process.env.CREDITCOIN_RPC_URL;
  if (!url) throw new Error("CREDITCOIN_RPC_URL is not set");
  return url;
}

export interface VerifiedTxEvidence {
  txHash: string;
  chainKey: number;
  height: number;
  /** Result of the on-chain precompile verification call. */
  verifiedOnChain: boolean;
}

export interface VerifyOutcome {
  proven: VerifiedTxEvidence[];
  failures: Array<{ txHash: string; error: string }>;
}

export { verifyTransactions } from "./creditcoin.js";
