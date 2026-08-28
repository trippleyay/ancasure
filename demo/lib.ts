/**
 * Shared helpers for the controlled Sepolia sandwich demo.
 *
 * SECURITY: reads PRIVATE_KEY from env (prepends 0x if missing), derives a
 * deterministic victim key from it. Private keys are NEVER printed or written
 * to disk — artifacts only ever contain public addresses and tx hashes.
 */
import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";

/** Unbuffered stdout — survives SIGTERM from sandbox timeouts. */
export function log(msg: string): void {
  fs.writeSync(1, msg + "\n");
}


export const ROOT = path.resolve(__dirname, "..");
export const DATA_DIR = path.join(ROOT, "data", "demo");
const ARTIFACTS = path.join(DATA_DIR, "artifacts.json");

/** Official Sepolia deployments (user-supplied, verified on-chain in setup). */
export const FACTORY = "0xF62c03E08ada871A0bEb309762E260a7a6a880E6";
export const ROUTER = "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3";
export const WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";

/** Budget config derived from actual balance — see run report for live numbers. */
export const POOL_WETH = ethers.parseEther("0.03"); // WETH-side liquidity
export const MINT_MEVTEST = ethers.parseEther("1000000"); // minted to deployer
export const FRONT_WETH = ethers.parseEther("0.0012"); // attacker front-run
export const VICTIM_WETH = ethers.parseEther("0.0024"); // victim trade (~8-9% loss)
export const VICTIM_FUNDING = ethers.parseEther("0.01"); // gas + trade headroom

/**
 * Attack sizing — tunable WITHOUT code changes via SANDWICH_PROFILE env.
 * Exact V2 math (loss peaks when front ≈ victim ≈ reserve):
 *   "gentle"   front = 10%  reserve, victim = 20%  -> ~16% loss, ~0.013 ETH/run
 *   "moderate" front = 30%  reserve, victim = 60%  -> ~35% loss, ~0.032 ETH/run
 *   "brutal"   front = 100% reserve, victim = 100% -> ~67% loss, ~0.035 ETH/run
 * Sizes are computed from LIVE reserves at run time, so the demo is
 * repeatable indefinitely — no fixed amounts that decay as the pool grows.
 */
export type SizingProfile = "gentle" | "moderate" | "brutal";
export function getSizingProfile(): SizingProfile {
  const p = (process.env.SANDWICH_PROFILE ?? "moderate").toLowerCase();
  return p === "gentle" ? "gentle" : p === "brutal" ? "brutal" : "moderate";
}
export function computeAttackSizes(reserveWeth: bigint, profile: SizingProfile): { front: bigint; victim: bigint } {
  const f = profile === "gentle" ? 1n : profile === "brutal" ? 10n : 3n;
  const v = profile === "gentle" ? 2n : profile === "brutal" ? 10n : 6n;
  return { front: (reserveWeth * f) / 10n, victim: (reserveWeth * v) / 10n };
}
/** Gas headroom for the victim tx: 350k gas × (2×baseFee + 12 gwei tip) can
 *  reach ~0.025 ETH at Sepolia base-fee spikes. Funding is a top-up to a
 *  persistent balance, so unused headroom carries over — generous is free. */
export const VICTIM_GAS_HEADROOM = ethers.parseEther("0.03");

function loadDotEnv(): void {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}

/** Sepolia JSON-RPC provider (Alchemy endpoint derived from repo .env).
 *  staticNetwork skips ethers' startup detection roundtrip, which times out
 *  intermittently against Alchemy from this environment. */
export function getProvider(): ethers.Provider & {
  send: (method: string, params: unknown[]) => Promise<unknown>;
} {
  loadDotEnv();
  // Optional direct override for CLI runs (e.g. publicnode when Alchemy is flaky)
  if (process.env.SEPOLIA_RPC_URL) {
    const netOv = new ethers.Network("sepolia", 11155111);
    return new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL, netOv, {
      staticNetwork: netOv,
      batchMaxCount: 1,
      pollingInterval: 2000,
    }) as never;
  }
  const mainnetUrl = process.env.ETHEREUM_RPC_URL;
  if (!mainnetUrl) throw new Error("ETHEREUM_RPC_URL is not set");
  const key = new URL(mainnetUrl).pathname.split("/").pop();
  const url = `https://eth-sepolia.g.alchemy.com/v2/${key}`;
  const fr = new ethers.FetchRequest(url);
  fr.timeout = 90_000;
  const net = new ethers.Network("sepolia", 11155111);
  return new ethers.JsonRpcProvider(fr, net, {
    staticNetwork: net,
    batchMaxCount: 1,
    pollingInterval: 2000,
  }) as never;
}

/** Retry helper for transient provider errors (Alchemy free tier is flaky here). */
export async function retry<T>(label: string, fn: () => Promise<T>, tries = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const waitMs = 1500 * i * i;
      console.log(`[retry] ${label} failed (${(e as Error).message?.slice(0, 80)}); retry ${i}/${tries} in ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}


/** Funded master wallet == attacker wallet. NEVER logs the private key. */
export function getMasterWallet(provider: ethers.Provider): ethers.Wallet {
  loadDotEnv();
  let pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY is not set");
  if (!pk.startsWith("0x")) pk = "0x" + pk;
  return new ethers.Wallet(pk, provider);
}

/**
 * Deterministic sub-wallet derived from the master private key via
 * keccak256(masterKeyBytes || label). Only the victim needs its own account.
 */
export function deriveChildKey(label: string): string {
  loadDotEnv();
  let pk = process.env.PRIVATE_KEY!;
  if (!pk.startsWith("0x")) pk = "0x" + pk;
  const bytes = ethers.getBytes(pk);
  return ethers.keccak256(ethers.solidityPacked(["bytes", "string"], [bytes, label]));
}

/**
 * The victim wallet for the controlled sandwich.
 * - If VICTIM_PRIVATE_KEY is set (judge-supplied wallet for live demos), that
 *   wallet is used as-is — the script only ever tops it UP (never moves funds
 *   out) and the judge's key is read from env, never logged or persisted.
 * - Otherwise a deterministic dev-victim is derived from the master key so
 *   testing needs no extra wallet. Fixture-only, not the real judge flow.
 */
export function getVictimWallet(provider: ethers.Provider): ethers.Wallet {
  loadDotEnv();
  const judgePk = process.env.VICTIM_PRIVATE_KEY;
  if (judgePk && judgePk.trim()) {
    let pk = judgePk.trim();
    if (!pk.startsWith("0x")) pk = "0x" + pk;
    return new ethers.Wallet(pk, provider);
  }
  return new ethers.Wallet(deriveChildKey("mev-shield-victim"), provider);
}

export interface Artifacts {
  mevTestToken?: string;
  pair?: string;
  liquidityTx?: string;
  attacker: string;
  victim: string;
  frontRunTx?: string;
  victimTx?: string;
  backRunTx?: string;
  blockNumber?: number;
  [k: string]: unknown;
}

export function saveArtifacts(a: Partial<Artifacts>): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const merged = { ...(fs.existsSync(ARTIFACTS) ? loadArtifacts() : {}), ...a };
  fs.writeFileSync(ARTIFACTS, JSON.stringify(merged, null, 2));
}

export function loadArtifacts(): Artifacts {
  return JSON.parse(fs.readFileSync(ARTIFACTS, "utf8"));
}

// --- Minimal ABI fragments (only what is actually called) ---
export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];
export const WETH_ABI = [...ERC20_ABI, "function deposit() payable", "function withdraw(uint256)"];
export const FACTORY_ABI = [
  "function createPair(address tokenA, address tokenB) returns (address pair)",
  "function getPair(address tokenA, address tokenB) view returns (address pair)",
  "function feeToSetter() view returns (address)",
  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
];
export const ROUTER_ABI = [
  "function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) payable returns (uint amountToken, uint amountETH, uint liquidity)",
  "function removeLiquidityETH(address token, uint liquidity, uint amountTokenMin, uint amountETHMin, address to, uint deadline) returns (uint amountToken, uint amountETH)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] path, address to, uint deadline) payable",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)",
  "function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)",
];
export const PAIR_ABI = ["function getReserves() view returns (uint112,uint112,uint32)", "function token0() view returns (address)", "function token1() view returns (address)"];

export function fmtEther(v: bigint): string {
  return ethers.formatEther(v);
}

/** Compute exact Uniswap V2 output (matches getAmountOut incl. 0.3% fee). */
export function v2GetAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  const ain = amountIn * 997n;
  return (ain * reserveOut) / (reserveIn * 1000n + ain);
}
