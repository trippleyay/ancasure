/**
 * Claim authorization service.
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
  "function policies(address) view returns (uint96 capRaw,bool active)",
];

/** On-chain quote for a pipeline-produced loss (view call; no key needed). */
export async function quotePayoutOnChain(claimant: string, verifiedLossRaw: bigint): Promise<bigint> {
  const d = loadDeployment();
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL!);
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
  loadDotEnv();
  const pk = process.env.AUTHORIZER_PRIVATE_KEY;
  if (!pk) throw new Error("AUTHORIZER_PRIVATE_KEY is not set");
  const d = loadDeployment();
  const rpc = process.env.SEPOLIA_RPC_URL!;
  if (!rpc) throw new Error("SEPOLIA_RPC_URL is not set");

  const wallet = new ethers.Wallet(pk.startsWith("0x") ? pk : "0x" + pk, new ethers.JsonRpcProvider(rpc));
  const c = new ethers.Contract(d.address, CLAIMS_ABI, wallet);
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
