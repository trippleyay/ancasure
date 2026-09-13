/**
 * Claim authorization service.
 *
 * Claim responsibility (strict order):
 *   1. user selects a protected wallet + victim tx hash
 *   2. Creditcoin/Attestcoin verifies the EXTERNAL-CHAIN evidence (transaction,
 *      ordering, receipt status, Swap/Sync logs, sandwich) — it is an evidence
 *      verifier ONLY, never the insurance-policy authority
 *   3. the backend computes the verified loss
 *   4. AncaSureClaims checks the wallet's active paid policy
 *   5. AncaSureClaims enforces cap, payout rules, duplicate-claim protection
 *   6. AncaSureClaims pays out
 *
 * The verified loss value submitted on-chain comes EXCLUSIVELY from the
 * detector+simulator pipeline — never from request bodies. The authorizer EOA
 * (backend signer) is the only identity allowed to call submitVerifiedClaim on
 * AncaSureClaims; see docs/claim-rules.md.
 */
import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import { loadDotEnv } from "@ancsure/shared";

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const DEPLOY_FILE = path.join(ROOT, "data", "demo", "claims-deployment.json");

interface Deployment {
  address: string;
  authorizer: string;
}

function loadDeployment(): Deployment {
  loadDotEnv();
  const addr = process.env.CLAIMS_CONTRACT_ADDRESS;
  if (addr) return { address: addr, authorizer: "" };
  if (!fs.existsSync(DEPLOY_FILE)) throw new Error("Claims contract not deployed (missing claims-deployment.json)");
  return JSON.parse(fs.readFileSync(DEPLOY_FILE, "utf8"));
}

const CLAIMS_ABI = [
  "function submitVerifiedClaim(address claimant,uint256 verifiedLossRaw,bytes32 victimTxHash) returns (uint256)",
  "function quotePayout(address user,uint256 verifiedLossRaw) view returns (uint256)",
  "function policies(address) view returns (uint96 capRaw,uint64 expiresAt,address payer)",
  "function isCovered(address user) view returns (bool)",
  "function PREMIUM_PER_WALLET() view returns (uint256)",
  "function payClaim(uint256 id)",
  "event PolicyRegistered(address indexed wallet, address indexed payer, uint256 capRaw, uint256 expiresAt)",
  "event ClaimAuthorized(uint256 indexed id, address indexed claimant, uint256 verifiedLossRaw, uint256 payoutRaw, bytes32 victimTxHash)",
  "event ClaimPaid(uint256 indexed id, address indexed claimant, uint256 amount)",
];

export function claimsContract(provider: ethers.Provider): ethers.Contract {
  const d = loadDeployment();
  return new ethers.Contract(d.address, CLAIMS_ABI, provider);
}

/** Resilient Sepolia provider (Alchemy free tier drops plain providers). */
function sepoliaProvider(): ethers.JsonRpcProvider {
  const url = process.env.SEPOLIA_RPC_URL!;
  const fr = new ethers.FetchRequest(url);
  fr.timeout = 60_000;
  const net = new ethers.Network("sepolia", 11155111);
  return new ethers.JsonRpcProvider(fr, net, { staticNetwork: net, batchMaxCount: 1 });
}

async function retry<T>(label: string, fn: () => Promise<T>, tries = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= tries; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1200 * i * i));
    }
  }
  throw lastErr;
}

export interface PolicyInfo {
  address: string;
  covered: boolean;
  capRaw: string;
  expiresAt: number; // unix seconds
  payer: string;
}

/** Read on-chain protection state for one wallet. */
export async function getPolicy(address: string): Promise<PolicyInfo> {
  const c = claimsContract(sepoliaProvider());
  const [capRaw, expiresAt, payer] = await retry("policies", () => c.policies(address));
  return {
    address,
    covered: Number(expiresAt) > Math.floor(Date.now() / 1000),
    capRaw: capRaw.toString(),
    expiresAt: Number(expiresAt),
    payer,
  };
}

export interface HistoryEntry {
  id: string;
  kind: "authorized" | "paid";
  claimant: string;
  amountRaw: string; // payoutRaw (authorized) or amount (paid)
  verifiedLossRaw?: string;
  victimTxHash?: string; // bytes32 → tx-hash-shaped hex
  txHash?: string; // eth tx that RECORDED the claim (submitVerifiedClaim)
  payoutTxHash?: string; // eth tx that PAID the claimant (payClaim)
  blockNumber: number;
}

const CLAIMS_LOG_PATH = path.join(ROOT, "data", "demo", "claims-log.jsonl");

/** Persist the payout tx hash onto the claim's log line (after payClaim settles). */
export function recordPayout(claimId: bigint | string, payoutTxHash: string): void {
  if (!fs.existsSync(CLAIMS_LOG_PATH)) return;
  const id = claimId.toString();
  const updated = fs.readFileSync(CLAIMS_LOG_PATH, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      let r: any;
      try { r = JSON.parse(line); } catch { return line; }
      if (r && r.claimId != null && String(r.claimId) === id) r.payoutTxHash = payoutTxHash;
      return JSON.stringify(r);
    });
  fs.writeFileSync(CLAIMS_LOG_PATH, updated.join("\n") + "\n");
}

/**
 * Claims history for one claimant.
 *
 * Source of truth: the server-side claims log (appended at authorize time).
 * eth_getLogs range queries are impractical on the free Alchemy tier (10-block
 * cap), so each entry's CURRENT on-chain state (Eligible → Paid?) is read back
 * from the contract with single-view calls instead of event scans.
 */
export async function getClaimsHistory(claimant: string): Promise<HistoryEntry[]> {
  const logPath = path.join(ROOT, "data", "demo", "claims-log.jsonl");
  if (!fs.existsSync(logPath)) return [];
  const c = claimsContract(sepoliaProvider());
  const claimantLower = claimant.toLowerCase();

  const rows = fs.readFileSync(logPath, "utf8").split("\n")
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter((r): r is any => !!r && String(r.claimant ?? "").toLowerCase() === claimantLower)
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));

  const out: HistoryEntry[] = [];
  for (const r of rows) {
    let kind: HistoryEntry["kind"] = "authorized";
    let amountRaw = "";
    let blockNumber = 0;
    if (r.claimId) {
      try {
        const claim = await retry("claims", () => c.claims(BigInt(r.claimId)));
        // claims(id) → [claimant, verifiedLossRaw, payoutRaw, state, victimTxHash]
        amountRaw = claim[2].toString();
        kind = Number(claim[3]) === 2 ? "paid" : "authorized";
      } catch { amountRaw = r.verifiedLossRaw ?? ""; }
    } else {
      amountRaw = r.verifiedLossRaw ?? "";
    }
    out.push({
      id: r.claimId != null ? String(r.claimId) : "",
      kind,
      claimant: r.claimant,
      amountRaw,
      verifiedLossRaw: r.verifiedLossRaw,
      victimTxHash: r.victimTxHash,
      txHash: r.txHash,
      ...(r.payoutTxHash ? { payoutTxHash: r.payoutTxHash } : {}),
      blockNumber,
    });
  }
  return out;
}

/** On-chain quote for a pipeline-produced loss (view call; no key needed). */
export async function quotePayoutOnChain(claimant: string, verifiedLossRaw: bigint): Promise<bigint> {
  const d = loadDeployment();
  const provider = sepoliaProvider();
  const c = new ethers.Contract(d.address, CLAIMS_ABI, provider);
  return c.quotePayout(claimant, verifiedLossRaw);
}

/**
 * Submits the verified claim through the authorizer key and waits for mining.
 * Returns the on-chain claim id + recorded payout.
 */
export async function authorizeClaim(
  claimant: string,
  verifiedLossRaw: bigint,
  victimTxHash: string,
): Promise<{ claimId: bigint; txHash: string }> {
  const c = new ethers.Contract(loadDeployment().address, CLAIMS_ABI, authorizerWallet());
  const tx = await c.submitVerifiedClaim(claimant, verifiedLossRaw, ethers.id(victimTxHash));
  const rc = await tx.wait();
  if (!rc || rc.status !== 1) throw new Error(`claim submission reverted (${rc?.hash})`);

  const ev = rc.logs
    .map((l: any) => {
      try {
        return c.interface.parseLog({ topics: [...l.topics], data: l.data });
      } catch {
        return null;
      }
    })
    .find((p: any) => p?.name === "ClaimAuthorized");

  fs.appendFileSync(
    path.join(ROOT, "data", "demo", "claims-log.jsonl"),
    JSON.stringify({
      at: new Date().toISOString(),
      claimId: ev ? ev.args.id.toString() : null,
      claimant,
      verifiedLossRaw: verifiedLossRaw.toString(),
      victimTxHash,
      txHash: rc.hash,
    }) + "\n",
  );
  return { claimId: ev ? BigInt(ev.args.id) : 0n, txHash: rc.hash };
}

/** Authorizer EOA wallet (empty AUTHORIZER_PRIVATE_KEY falls back to PRIVATE_KEY). */
function authorizerWallet(): ethers.Wallet {
  loadDotEnv();
  const pk = [process.env.AUTHORIZER_PRIVATE_KEY, process.env.PRIVATE_KEY]
    .find((k) => k && k.trim());
  if (!pk) throw new Error("AUTHORIZER_PRIVATE_KEY (or PRIVATE_KEY) is not set");
  const rpc = process.env.SEPOLIA_RPC_URL;
  if (!rpc) throw new Error("SEPOLIA_RPC_URL is not set");
  return new ethers.Wallet(pk.startsWith("0x") ? pk : "0x" + pk, new ethers.JsonRpcProvider(rpc));
}

/**
 * Settles an authorized claim: transfers the payout to the claimant.
 * submitVerifiedClaim only RECORDS the claim — this is the tx that pays.
 */
export async function payClaimOnChain(claimId: bigint): Promise<string> {
  const c = new ethers.Contract(loadDeployment().address, CLAIMS_ABI, authorizerWallet());
  const tx = await c.payClaim(claimId);
  const rc = await tx.wait();
  if (!rc || rc.status !== 1) throw new Error(`payout reverted (${rc?.hash})`);
  return rc.hash;
}
