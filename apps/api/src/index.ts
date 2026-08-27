/**
 * AncaSure backend API.
 *
 * Internal/service-level flow (MVP):
 *   POST /detect            {victimTxHash, chain?}
 *   POST /simulate          {victimTxHash, chain?}
 *   POST /verify            {chain, txHashes[]}         Creditcoin/Attestcoin proofs
 *   POST  /swap-request     {judgeAddress}              unsigned victim swap for judge signing
 *   POST  /execute-sandwich {signedVictimRawTx}         controlled trio around judge's tx
 *   POST  /claim            {victimTxHash}              full pipeline → authorized on-chain claim
 *   GET   /run-latest                                   last controlled run artifacts
 *
 * Runs with tsx (no build step): npm run dev:api
 */
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import {
  isSourceChain,
  loadDotEnv,
  rpcUrlFor,
  DEFAULT_POLICY_CAP_RAW,
  CLAIM_RATIO_NUMERATOR,
  CLAIM_RATIO_DENOMINATOR,
  type SourceChain,
} from "@ancsure/shared";
import { detectForTxHash } from "@ancsure/detector";
import { getSepoliaProvider, sepoliaMasterWallet } from "@ancsure/ethereum";
import { simulateAndSerialize } from "./services/simulation.js";
import { verifyEvidence } from "./services/verification.js";
import { authorizeClaim } from "./services/claims.js";
import {
  executeControlledSandwich,
  buildVictimSwapRequest,
} from "../../../demo/sandwich/service.js";
import { loadArtifacts } from "../../../demo/lib.js";

const PORT = Number(process.env.PORT ?? 3000);
const ROOT = path.resolve(__dirname, "..", "..", "..");
const RUN_FILE = path.join(ROOT, "data", "demo", "run-latest.json");

// ---------------------------------------------------------------- helpers ---

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(text);
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c: Buffer) => {
      data += c;
      if (data.length > 1_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function resolveChain(chain?: string): SourceChain {
  const c = chain ?? process.env.DEFAULT_SOURCE_CHAIN ?? "ethereum-sepolia";
  if (!isSourceChain(c)) throw new Error(`unsupported source chain: ${c}`);
  return c;
}

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

// ------------------------------------------------------------------ router ---

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url!, `http://localhost:${PORT}`);
    await route(req, res, url.pathname);
  } catch (e) {
    json(res, 500, { error: (e as Error).message ?? String(e) });
  }
});

async function route(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<void> {
  // ---------- health ----------
  if (req.method === "GET" && pathname === "/health") {
    json(res, 200, { ok: true, service: "ancasure-api" });
    return;
  }

  // ---------- POST /detect ----------
  if (req.method === "POST" && pathname === "/detect") {
    const body = await readBody(req);
    const hash: string = body.victimTxHash;
    if (!hash || !HASH_RE.test(hash)) throw new Error("victimTxHash must be a 32-byte hex hash");
    const chain = resolveChain(body.chain);
    const result = await detectForTxHash(rpcUrlFor(chain), hash);
    json(res, 200, { chain, result });
    return;
  }

  // ---------- POST /simulate ----------
  if (req.method === "POST" && pathname === "/simulate") {
    const body = await readBody(req);
    const hash: string = body.victimTxHash;
    if (!hash || !HASH_RE.test(hash)) throw new Error("victimTxHash must be a 32-byte hex hash");
    const chain = resolveChain(body.chain);
    const report = await simulateAndSerialize(rpcUrlFor(chain), hash);
    json(res, 200, { chain, report });
    return;
  }

  // ---------- POST /verify — Creditcoin/Attestcoin proof verification ----------
  if (req.method === "POST" && pathname === "/verify") {
    const body = await readBody(req);
    const chain = resolveChain(body.chain);
    const hashes: string[] = Array.isArray(body.txHashes) ? body.txHashes : [];
    const outcome = await verifyEvidence(hashes, chain);
    json(res, 200, { chain, provenCount: outcome.proven.length, ...outcome });
    return;
  }

  // ---------- POST /swap-request — unsigned victim swap for the JUDGE ----------
  if (req.method === "POST" && pathname === "/swap-request") {
    const body = await readBody(req);
    if (!body.judgeAddress || !/^0x[0-9a-fA-F]{40}$/.test(body.judgeAddress)) {
      throw new Error("judgeAddress must be a valid address");
    }
    const art = loadArtifacts();
    if (!art.mevTestToken) throw new Error("demo environment not initialized (run demo/token, demo/pool)");
    const request = await buildVictimSwapRequest(body.judgeAddress, art.mevTestToken);
    json(res, 200, { ...request, judgeAddress: body.judgeAddress });
    return;
  }

  // ---------- POST /execute-sandwich — controlled trio around judge's tx ------
  if (req.method === "POST" && pathname === "/execute-sandwich") {
    const body = await readBody(req);
    const raw: string = body.signedVictimRawTx;
    if (!raw || !raw.startsWith("0x")) throw new Error("signedVictimRawTx required");
    // Basic integrity check: require a well-formed signed tx and record its sender.
    const parsed = ethers.Transaction.from(raw);
    if (!parsed.from || !/^0x[0-9a-fA-F]{40}$/.test(parsed.from)) {
      throw new Error("could not recover judge address from signature");
    }
    const outcome = await executeControlledSandwich({
      provider: getSepoliaProvider(),
      attackerWallet: sepoliaMasterWallet(getSepoliaProvider()),
      getVictimRawTx: async () => raw,
      say: console.log,
    }).catch((e) => ({ ok: false as const, reason: e.message }));
    fs.writeFileSync(
      RUN_FILE,
      JSON.stringify({ at: new Date().toISOString(), judge: parsed.from, outcome }, null, 2),
    );
    json(res, outcome.ok ? 200 : 422, outcome);
    return;
  }

  // ---------- POST /claim — full pipeline → authorized on-chain claim --------
  if (req.method === "POST" && pathname === "/claim") {
    const body = await readBody(req);
    const hash: string = body.victimTxHash;
    if (!hash || !HASH_RE.test(hash)) throw new Error("victimTxHash must be a hex hash");
    const chain = resolveChain(body.chain);

    // 1) detection
    const result = await detectForTxHash(rpcUrlFor(chain), hash);
    if (result.classification !== "SANDWICH") {
      json(res, 422, { eligible: false, reason: result.explanation ?? "not a sandwich" });
      return;
    }
    // 2) verified loss from the proven simulator
    const report: any = await simulateAndSerialize(rpcUrlFor(chain), hash);
    const lossRaw = BigInt(
      report?.victims?.[0]?.verifiedLossRaw ?? report?.victims?.[0]?.loss ?? report?.totalLossRaw ?? 0,
    );
    if (lossRaw <= 0n) {
      json(res, 422, { eligible: false, reason: "simulated loss is zero" });
      return;
    }
    // 3) Creditcoin proofs for all three transactions (must verify cleanly)
    const hashes = [result.frontRunTx!, hash, result.backRunTx!];
    const proof = await verifyEvidence(hashes, chain);
    if (proof.failures.length > 0) {
      json(res, 502, { eligible: false, reason: "proof pipeline failures", failures: proof.failures });
      return;
    }
    // 4) authorized submission — loss value originates here, not from the client
    const provider = new ethers.JsonRpcProvider(rpcUrlFor(chain));
    const victimTx = await provider.getTransaction(hash);
    if (!victimTx) throw new Error("victim tx not found");
    const claimant = victimTx.from;
    const claim = await authorizeClaim(claimant, lossRaw, hash);
    json(res, 200, {
      eligible: true,
      claimId: claim.claimId.toString(),
      payoutTxHash: claim.txHash,
      verifiedLossRaw: lossRaw.toString(),
      ratio: `${CLAIM_RATIO_NUMERATOR}/${CLAIM_RATIO_DENOMINATOR}`,
      defaultCapRaw: DEFAULT_POLICY_CAP_RAW,
    });
    return;
  }

  // ---------- GET /run-latest ----------
  if (req.method === "GET" && pathname === "/run-latest") {
    if (!fs.existsSync(RUN_FILE)) throw new Error("no controlled run recorded yet");
    json(res, 200, JSON.parse(fs.readFileSync(RUN_FILE, "utf8")));
    return;
  }

  json(res, 404, { error: `no route: ${pathname}` });
}

loadDotEnv(path.dirname(RUN_FILE));
server.listen(PORT, () => {
  console.log(`AncaSure API listening on :${PORT}`);
});
