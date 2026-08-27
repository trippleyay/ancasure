import { ethers } from "ethers";

/**
 * Product-level configuration constants.
 *
 * The claim economics implemented in this MVP:
 *   payout = min(70% of verified loss, policy cap)
 */
export const CLAIM_RATIO_NUMERATOR = 70n;
export const CLAIM_RATIO_DENOMINATOR = 100n;

/** Default per-policy payout cap (in payout-token raw units) if none supplied at registration. */
export const DEFAULT_POLICY_CAP_RAW = ethers.parseEther("0.05").toString();

/** Source chains currently attested on Creditcoin CC3 testnet (per product spec). */
export const SOURCE_CHAINS = ["ethereum-mainnet", "ethereum-sepolia"] as const;
export type SourceChain = (typeof SOURCE_CHAINS)[number];

export function isSourceChain(v: string): v is SourceChain {
  return (SOURCE_CHAINS as readonly string[]).includes(v);
}

/** Sepolia constants used by the controlled demo (official deployments). */
export const SEPOLIA = {
  chainId: 11155111,
  /** Official Sepolia WETH9. */
  WETH: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
  /** Uniswap V2-compatible factory deployed on Sepolia (same init code hash). */
  FACTORY_V2: "0xF62c03E08ada871A0bEb309762E260a7a6a880E6",
  /** Uniswap V2-compatible Router02 on Sepolia. */
  ROUTER_V2: "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3",
} as const;

/** Canonical Swap/Sync topics (Uniswap V2). */
export const SWAP_TOPIC =
  "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";
export const SYNC_TOPIC =
  "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1";

/**
 * Minimal .env loader (upward search from CWD). Only ever used to source
 * PUBLIC configuration and locally-held keys into process.env; secrets are
 * never logged or persisted by this repository.
 */
export function loadDotEnv(startDir?: string): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs") as typeof import("fs");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require("path") as typeof import("path");
  let dir = startDir ?? process.cwd();
  while (true) {
    const p = path.join(dir, ".env");
    if (fs.existsSync(p)) {
      for (const line of fs.readFileSync(p, "utf8").split("\n")) {
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
      }
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

/**
 * RPC URL per source chain. Mainnet and Sepolia have independent endpoints;
 * a SEPOLIA_RPC_URL override wins for Sepolia because free-tier Alchemy URLs
 * are frequently shared between both chains (the ?key suffix is reusable).
 */
export function rpcUrlFor(chain: SourceChain): string {
  loadDotEnv();
  if (chain === "ethereum-sepolia" && process.env.SEPOLIA_RPC_URL)
    return process.env.SEPOLIA_RPC_URL;
  const url = process.env.ETHEREUM_RPC_URL;
  if (!url) throw new Error(`RPC URL for ${chain} not configured (set ETHEREUM_RPC_URL${chain === "ethereum-sepolia" ? " / SEPOLIA_RPC_URL" : ""})`);
  return url;
}
