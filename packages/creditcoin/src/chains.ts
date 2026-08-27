/**
 * Source-chain registry resolution for Attestcoin (CC3 testnet).
 *
 * Chain keys are NOT assumed — they are resolved at runtime from the ChainInfo
 * precompile's supported-chain registry by metadata matching (same proven
 * approach as MEVdetector scripts/usc-supported-chains.ts). CC_CHAIN_KEY_<ID>
 * env vars override resolution when pinning is desired.
 */
import { ethers } from "ethers";
import { chainInfo } from "@gluwa/usc-sdk";
import type { SourceChain } from "@ancsure/shared";

export const DEFAULT_CREDITCOIN_RPC = "https://rpc.cc3-testnet.creditcoin.network";

export function getCreditcoinProvider(): ethers.JsonRpcProvider {
  const url = process.env.CREDITCOIN_RPC_URL ?? DEFAULT_CREDITCOIN_RPC;
  return new ethers.JsonRpcProvider(url);
}

interface SupportedChainLike {
  chainKey: number | string | bigint;
  chainName?: string;
  [k: string]: unknown;
}

function chainKeyOf(c: SupportedChainLike | chainInfo.ChainInfo): number {
  return Number((c as SupportedChainLike).chainKey);
}

const cache = new Map<SourceChain, number>();

/** Resolve the Creditcoin chainKey for a source chain via the precompile. */
export async function resolveSourceChainKey(chain: SourceChain): Promise<number> {
  const overrideKey = `CC_CHAIN_KEY_${chain.replace(/-/g, "_").toUpperCase()}`;
  if (process.env[overrideKey]) return Number(process.env[overrideKey]);
  const cached = cache.get(chain);
  if (cached !== undefined) return cached;

  const provider = getCreditcoinProvider();
  const info = new chainInfo.PrecompileChainInfoProvider(provider);
  const supported = (await info.getSupportedChains()) as unknown as SupportedChainLike[];

  const wantSepolia = chain === "ethereum-sepolia";
  const match = supported.find((c) => {
    const blob = JSON.stringify(c).toLowerCase();
    return blob.includes("ethereum") && blob.includes(wantSepolia ? "sepolia" : "mainnet");
  });
  if (!match) {
    throw new Error(
      `Source chain "${chain}" not found in CC3 attestation registry. ` +
        `Supported: ${supported.map((c) => JSON.stringify(c)).join(", ")}`,
    );
  }
  const key = chainKeyOf(match);
  cache.set(chain, key);
  return key;
}
