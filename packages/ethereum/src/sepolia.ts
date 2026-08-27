/**
 * Sepolia provider / RPC-retry helpers.
 *
 * Ported from the validated sandwich-demo `lib.ts` (logic unchanged where it
 * matters): staticNetwork JsonRpcProvider against Alchemy (the startup network
 * detection roundtrip intermittently times out on free tier), plus a quadratic
 * backoff retry wrapper used by every on-chain script in the golden run.
 */
import { ethers } from "ethers";
import { SEPOLIA, loadDotEnv } from "@ancsure/shared";

/** Unbuffered stdout — survives SIGTERM/timeouts in long-running scripts. */
export function log(msg: string): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("fs").writeSync(1, msg + "\n");
}

export function getSepoliaProvider(): ethers.Provider & {
  send: (method: string, params: unknown[]) => Promise<unknown>;
} {
  if (process.env.SEPOLIA_RPC_URL) {
    const net = new ethers.Network("sepolia", SEPOLIA.chainId);
    return new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL, net, {
      staticNetwork: net,
      batchMaxCount: 1,
      pollingInterval: 2000,
    }) as never;
  }
  // Derive the Sepolia endpoint from an Alchemy mainnet URL (same API key).
  const mainnetUrl = process.env.ETHEREUM_RPC_URL;
  if (!mainnetUrl) throw new Error("SEPOLIA_RPC_URL or ETHEREUM_RPC_URL must be set");
  const key = new URL(mainnetUrl).pathname.split("/").pop() ?? "";
  const url = `https://eth-sepolia.g.alchemy.com/v2/${key}`;
  const fr = new ethers.FetchRequest(url);
  fr.timeout = 90_000;
  const net = new ethers.Network("sepolia", SEPOLIA.chainId);
  return new ethers.JsonRpcProvider(fr, net, {
    staticNetwork: net,
    batchMaxCount: 1,
    pollingInterval: 2000,
  }) as never;
}

/** Retry helper for transient provider errors (free-tier RPCs are flaky). */
export async function retryRpc<T>(
  label: string,
  fn: () => Promise<T>,
  tries = 5,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const waitMs = 1500 * i * i;
      log(`[retry] ${label} failed (${(e as Error).message?.slice(0, 80)}); retry ${i}/${tries} in ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

/**
 * Wallet funded for the controlled attacker role. NEVER logs the private key.
 */
export function sepoliaMasterWallet(provider: ethers.Provider): ethers.Wallet {
  loadDotEnv();
  let pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY is not set");
  if (!pk.startsWith("0x")) pk = "0x" + pk;
  return new ethers.Wallet(pk, provider);
}

/** Exact official Uniswap V2 getAmountOut (identical to packages/simulator math). */
export function v2GetAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  const ain = amountIn * 997n;
  return (ain * reserveOut) / (reserveIn * 1000n + ain);
}
