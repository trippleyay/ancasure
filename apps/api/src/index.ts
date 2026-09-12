/**
 * AncaSure backend API.
 *
 * Internal/service-level flow (MVP):
 *   POST /detect            {victimTxHash, chain?}
 *   POST /simulate          {victimTxHash, chain?}
 *   POST /verify            {chain, txHashes[]}         Creditcoin/Attestcoin proofs
 *   POST /check-eligibility {victimTxHash}              read-only claim check (no mutation)
 *   GET  /policies          ?addresses=0x..,..           on-chain protection state
 *   GET  /wallets           ?owner=0x..                  stored wallet book + live coverage
 *   POST /wallets           {owner, address}             add wallet to owner's book
 *   DELETE /wallets         {owner, address}             remove an unprotected added wallet
 *   GET  /claims-history    ?address=0x..                ClaimAuthorized/Paid events
 *   POST  /swap-request     {judgeAddress}              unsigned victim swap for judge signing
 *   POST  /execute-sandwich {signedVictimRawTx}         controlled trio around judge's tx
 *   POST  /attack-prepare     {victimAddress}            mempool-watch attack for browser wallets
 *   GET   /attack-status      ?watchId=..                mempool-watch outcome
 *   GET   /mev-demo                                     standalone MEV Creator frontend (attack simulator)
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
import { simulateAndSerialize, verifiedLossEthWei } from "./services/simulation.js";
import { verifyEvidence } from "./services/verification.js";
import { authorizeClaim, getPolicy, getClaimsHistory, quotePayoutOnChain } from "./services/claims.js";
import {
  executeControlledSandwich,
  buildVictimSwapRequest,
  startMempoolSandwich,
} from "../../../demo/sandwich/service.js";
import { loadArtifacts } from "../../../demo/lib.js";

/** In-memory registry of mempool-watch attacks (per process; demo scope). */
const mempoolWatches = new Map<string, Awaited<ReturnType<typeof startMempoolSandwich>>>();

const PORT = Number(process.env.PORT ?? 3000);
const ROOT = path.resolve(__dirname, "..", "..", "..");
const RUN_FILE = path.join(ROOT, "data", "demo", "run-latest.json");

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const MAX_ADDED_WALLETS = 24; // per owner, on top of the connected wallet

// ------------------------------------------------- wallet book (SQLite) ------
// Owners add wallets on the Dashboard; the owner→wallet relationship is
// persisted server-side in SQLite (DATABASE_PATH, default data/ancasure.db)
// so it survives browsers/devices. ONLY the relationship is stored:
// owner_address, wallet_address, created_at (unique per pair).
// Paid/protected state is NOT stored here — it is joined live from the
// on-chain AncaSureClaims contract (getPolicy) so it can never go stale.

import { walletStore } from "./services/walletStore.js";
import { buildWalletBook } from "./services/walletBook.js";

/** Owner's wallet book with live on-chain protection state joined in. */
async function walletBookResponse(ownerLc: string) {
  return buildWalletBook(ownerLc);
}

// ---------------------------------------------------------------- helpers ---

function cors(res: http.ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  cors(res);
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
  cors(res);
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
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
    // Claims contract address: env wins, else the deploy script's output file.
    let claimsAddress = process.env.CLAIMS_CONTRACT_ADDRESS ?? "";
    if (!claimsAddress) {
      try {
        claimsAddress = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "demo", "claims-deployment.json"), "utf8")).address ?? "";
      } catch { /* not deployed yet */ }
    }
    json(res, 200, {
      ok: true,
      service: "ancasure-api",
      // Public WalletConnect project id (safe to expose — it is a browser-side
      // identifier, not a secret). Set WALLETCONNECT_PROJECT_ID in .env;
      // free registration at https://cloud.walletconnect.com
      wcProjectId: process.env.WALLETCONNECT_PROJECT_ID ?? "",
      claimsContractAddress: claimsAddress,
    });
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

  // ---------- POST /attack-prepare — mempool-watch attack (browser wallets) ----
  // Desktop MetaMask no longer supports eth_signTransaction, so the victim
  // broadcasts their OWN swap (normal eth_sendTransaction, 12.01 gwei tip).
  // This plans the attack, returns the unsigned victim swap and starts an
  // in-memory watcher that sandwiches it the moment it hits the mempool.
  if (req.method === "POST" && pathname === "/attack-prepare") {
    const body = await readBody(req);
    const victim: string = String(body.victimAddress ?? "").toLowerCase();
    if (!ADDR_RE.test(victim)) throw new Error("victimAddress must be a 0x.. address");
    const watch = await startMempoolSandwich(
      getSepoliaProvider(),
      sepoliaMasterWallet(getSepoliaProvider()),
      victim,
      { say: console.log },
    );
    mempoolWatches.set(watch.id, watch);
    json(res, 200, { watchId: watch.id, swap: watch.swap });
    return;
  }

  // ---------- GET /attack-status?watchId=.. ------------------------------------
  if (req.method === "GET" && pathname === "/attack-status") {
    const url = new URL(req.url!, `http://localhost:${PORT}`);
    const id = url.searchParams.get("watchId") ?? "";
    const watch = mempoolWatches.get(id);
    if (!watch) throw new Error("unknown watchId");
    json(res, 200, watch.status());
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
    // 2) verified loss from the proven simulator, valued in ETH at the
    //    pre-attack pool price (the contract pays out in ETH)
    const report: any = await simulateAndSerialize(rpcUrlFor(chain), hash);
    const lossRaw = verifiedLossEthWei(report) ?? 0n;
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

  // ---------- GET /policies?addresses=0x..,0x.. -------------------------------
  if (req.method === "GET" && pathname === "/policies") {
    const url = new URL(req.url!, `http://localhost:${PORT}`);
    const addrs = (url.searchParams.get("addresses") ?? "")
      .split(",").map((a) => a.trim()).filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
    if (addrs.length === 0) throw new Error("addresses query param required (comma-separated)");
    const policies = [];
    for (const a of [...new Set(addrs)].slice(0, 25)) {
      try { policies.push(await getPolicy(a)); }
      catch (e) { policies.push({ address: a, covered: false, capRaw: "0", expiresAt: 0, payer: "", error: (e as Error).message }); }
    }
    json(res, 200, { policies });
    return;
  }

  // ---------- GET /wallets?owner=0x.. -----------------------------------------
  // The owner's stored wallet list with live on-chain protection state joined.
  if (req.method === "GET" && pathname === "/wallets") {
    const url = new URL(req.url!, `http://localhost:${PORT}`);
    const owner = (url.searchParams.get("owner") ?? "").trim().toLowerCase();
    if (!ADDR_RE.test(owner)) throw new Error("owner must be a 0x.. address");
    json(res, 200, await walletBookResponse(owner));
    return;
  }

  // ---------- POST /wallets {owner, address} -----------------------------------
  // Add a wallet to the owner's list (deduped; the connected wallet is implicit).
  if (req.method === "POST" && pathname === "/wallets") {
    const body = await readBody(req);
    const owner = String(body.owner ?? "").trim().toLowerCase();
    const address = String(body.address ?? "").trim().toLowerCase();
    if (!ADDR_RE.test(owner)) throw new Error("owner must be a 0x.. address");
    if (!ADDR_RE.test(address)) throw new Error("address must be a 0x.. wallet address");
    if (address === owner) throw new Error("the connected wallet is already in your list");
    if (walletStore.has(owner, address)) throw new Error("that wallet is already in your list");
    if (walletStore.count(owner) >= MAX_ADDED_WALLETS) throw new Error(`wallet list is full (max ${MAX_ADDED_WALLETS})`);
    walletStore.add(owner, address);
    json(res, 200, await walletBookResponse(owner));
    return;
  }

  // ---------- DELETE /wallets {owner, address} ---------------------------------
  // Remove a wallet — allowed ONLY for unprotected (not covered) added wallets;
  // wallets with paid protection and the connected wallet itself are rejected.
  if (req.method === "DELETE" && pathname === "/wallets") {
    const body = await readBody(req);
    const owner = String(body.owner ?? "").trim().toLowerCase();
    const address = String(body.address ?? "").trim().toLowerCase();
    if (!ADDR_RE.test(owner)) throw new Error("owner must be a 0x.. address");
    if (!ADDR_RE.test(address)) throw new Error("address must be a 0x.. wallet address");
    if (address === owner) throw new Error("the connected wallet cannot be removed");
    if (!walletStore.has(owner, address)) throw new Error("that wallet is not in your list");
    let policy: Awaited<ReturnType<typeof getPolicy>> | null = null;
    try { policy = await getPolicy(address); } catch { /* RPC down — treat as unprotected */ }
    if (policy?.covered) throw new Error("that wallet has active protection and cannot be removed");
    walletStore.remove(owner, address);
    json(res, 200, await walletBookResponse(owner));
    return;
  }

  // ---------- GET /claims-history?address=0x.. --------------------------------
  if (req.method === "GET" && pathname === "/claims-history") {
    const url = new URL(req.url!, `http://localhost:${PORT}`);
    const addr = url.searchParams.get("address") ?? "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) throw new Error("address query param required");
    json(res, 200, { claims: await getClaimsHistory(addr) });
    return;
  }

  // ---------- POST /check-eligibility {victimTxHash} --------------------------
  // Read-only pipeline: detect → simulate → verify → quote. NEVER authorizes or
  // mutates the contract — the Claim screen uses this for its eligible/not state.
  if (req.method === "POST" && pathname === "/check-eligibility") {
    const body = await readBody(req);
    const hash: string = body.victimTxHash;
    if (!hash || !HASH_RE.test(hash)) throw new Error("victimTxHash must be a hex hash");
    const chain = resolveChain(body.chain);

    const result = await detectForTxHash(rpcUrlFor(chain), hash);
    if (result.classification !== "SANDWICH") {
      json(res, 200, { eligible: false, classification: result.classification, reason: result.explanation ?? "not a sandwich" });
      return;
    }
    const report: any = await simulateAndSerialize(rpcUrlFor(chain), hash);
    const leg = report?.victims?.find((v: any) => v?.legs?.length > 0)?.legs?.[0];
    const lossRaw = verifiedLossEthWei(report) ?? 0n;
    if (lossRaw <= 0n) {
      json(res, 200, { eligible: false, classification: "SANDWICH", reason: "simulated loss is zero" });
      return;
    }
    const hashes = [result.frontRunTx!, hash, result.backRunTx!];
    const proof = await verifyEvidence(hashes, chain);
    if (proof.failures.length > 0) {
      json(res, 502, { eligible: false, classification: "SANDWICH", reason: "proof pipeline failures", failures: proof.failures });
      return;
    }
    // claimant = victim tx signer (wallet must have controlled the protected wallet)
    const provider = new ethers.JsonRpcProvider(rpcUrlFor(chain));
    const victimTx = await provider.getTransaction(hash);
    if (!victimTx) throw new Error("victim tx not found");
    const claimant = victimTx.from;
    let payoutQuoteRaw = "0";
    try { payoutQuoteRaw = (await quotePayoutOnChain(claimant, lossRaw)).toString(); } catch { /* contract not configured */ }
    const policy = await getPolicy(claimant).catch(() => null);

    json(res, 200, {
      eligible: policy?.covered === true && BigInt(payoutQuoteRaw) > 0n,
      classification: "SANDWICH",
      claimant,
      evidence: {
        frontRunTx: result.frontRunTx,
        victimTxHash: hash,
        backRunTx: result.backRunTx,
        blockNumber: report.blockNumber,
        attacker: report.attacker,
        pools: report.pools,
      },
      execution: leg ? {
        inputRaw: leg.inputAmount.toString(),
        actualOutputRaw: leg.actualOutput.toString(),
        counterfactualOutputRaw: leg.counterfactualOutput.toString(),
        lossRaw: leg.loss.toString(),
        exactMatch: leg.exactMatch,
      } : null,
      verifiedLossRaw: lossRaw.toString(), // ETH wei
      payoutQuoteRaw,                      // ETH wei, from the contract
      policy,
      ratio: `${CLAIM_RATIO_NUMERATOR}/${CLAIM_RATIO_DENOMINATOR}`,
    });
    return;
  }

  // ---------- GET /mev-demo — standalone MEV Creator frontend ------------------
  // Static single-file app (apps/mev-demo/index.html): anyone connects a wallet
  // (WalletConnect QR or injected) and fires a controlled sandwich on Sepolia.
  // Separate from the AncaSure product UI — this only CREATES attacks.
  if (req.method === "GET" && pathname === "/mev-demo") {
    const html = fs.readFileSync(path.join(ROOT, "apps", "mev-demo", "index.html"), "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
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
