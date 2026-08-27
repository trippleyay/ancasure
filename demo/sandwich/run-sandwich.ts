/**
 * Step 3 — execute the controlled sandwich and verify ordering.
 *
 *   npx tsx scripts/sandwich-demo/run-sandwich.ts
 *
 * Ordering control: the moment a new Sepolia block lands (~12s window until the
 * next one), we broadcast three PRE-SIGNED transactions nearly simultaneously
 * with DESCENDING priority fees:
 *     front-run (attacker)  tip 30 gwei -> packed FIRST
 *     victim                tip 10 gwei -> packed SECOND
 *     back-run  (attacker)  tip  1 gwei -> packed LAST
 * Builders order across accounts by priority fee desc, so we get
 * [front][victim][back] provided all three are in the mempool before building
 * starts. Attacker front/back share one account with consecutive nonces
 * (their relative order is guaranteed regardless). On failure amounts are
 * recomputed from live reserves and the sequence retried.
 */
import { ethers } from "ethers";
import {
  getProvider,
  getMasterWallet,
  deriveChildKey,
  loadArtifacts,
  saveArtifacts,
  retry,
  WETH,
  ERC20_ABI,
  ROUTER_ABI,
  PAIR_ABI,
  ROUTER,
  FRONT_WETH,
  VICTIM_WETH,
  v2GetAmountOut,
} from "../lib";

const MAX_ATTEMPTS = 6;
// Tight tip ladder: only a spam tx paying EXACTLY 12.00–12.02 gwei could
// interleave between our three transactions in the same block window.
const TIP_FRONT = ethers.parseUnits("12.02", "gwei");
const TIP_VICTIM = ethers.parseUnits("12.01", "gwei");
const TIP_BACK = ethers.parseUnits("12.00", "gwei");
const GAS_SWAP = 350_000;

/** Swap(address,uint256,uint256,uint256,uint256,address) — V2 canonical. */
export const SWAP_TOPIC = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";
/** Sync(uint112,uint112) — V2 canonical, corrected hash per handover note. */
export const SYNC_TOPIC = "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1";

interface Outcome {
  ok: boolean;
  reason?: string;
  block?: number;
  frontHash?: string;
  victimHash?: string;
  backHash?: string;
}

export async function main(): Promise<void> {
  const provider = getProvider();
  const attacker = getMasterWallet(provider); // front+back sender (R2: same `from`)
  const victim = new ethers.Wallet(deriveChildKey("mev-shield-victim"), provider);
  const art = loadArtifacts();
  if (!art.pair || !art.mevTestToken) throw new Error("Run setup-pool.ts first");

  const router = new ethers.Contract(ROUTER, ROUTER_ABI, attacker);
  const mevAttacker = new ethers.Contract(art.mevTestToken, ERC20_ABI, attacker);
  const mevView = new ethers.Contract(art.mevTestToken, ERC20_ABI, provider);
  const pairC = new ethers.Contract(art.pair, PAIR_ABI, provider);
  const chainId = (await provider.getNetwork()).chainId;

  console.log(`Attacker ${attacker.address} | Victim ${victim.address} | Pair ${art.pair}`);

  let outcome: Outcome | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !outcome?.ok; attempt++) {
    // ---- Plan amounts from live pool state ----------------------------------
    const deadline = Math.floor(Date.now() / 1000) + 120;
    const [r0, r1] = await pairC.getReserves();
    const wethIs0 = String(await pairC.token0()).toLowerCase() === WETH.toLowerCase();
    const rin = wethIs0 ? r0 : r1;   // WETH reserve
    const rout = wethIs0 ? r1 : r0;  // MEVTEST reserve

    const frontOut = v2GetAmountOut(FRONT_WETH, rin, rout);
    const cfOut = v2GetAmountOut(VICTIM_WETH, rin, rout);            // counterfactual
    const vicOut = v2GetAmountOut(VICTIM_WETH, rin + FRONT_WETH, rout - frontOut);
    const predLossBps = ((cfOut - vicOut) * 10000n) / cfOut;
    console.log(
      `\n[attempt ${attempt}] pool=${ethers.formatEther(rin)} WETH | victimOut≈${ethers.formatEther(vicOut)} vs CF≈${ethers.formatEther(cfOut)} MEVTEST -> predicted loss ${(Number(predLossBps) / 100).toFixed(2)}%`,
    );
    if (predLossBps < 100n || predLossBps > 1200n) {
      console.log("[attempt] predicted loss outside 1-12% band — aborting (do not drain wallet)");
      return;
    }

    // Back-run sells existing dust + exact predicted front-run proceeds (-0.05%).
    const dustBal = await mevAttacker.balanceOf(attacker.address);
    const backSellAmount = ((dustBal + frontOut) * 9995n) / 10000n;

    const latestBlock = await retry("getBlock", () => provider.getBlock("latest"));
    const baseFee = latestBlock?.baseFeePerGas ?? ethers.parseUnits("15", "gwei");
    const fees = (tip: bigint) => ({
      maxPriorityFeePerGas: tip,
      maxFeePerGas: baseFee * 2n + tip,
      gasLimit: GAS_SWAP,
      type: 2 as const,
      chainId,
    });

    const pathEthToTok = [WETH, art.mevTestToken];
    const pathTokToEth = [art.mevTestToken, WETH];

    // ---- Pre-sign all three right after a fresh block ------------------------
    console.log(`[attempt ${attempt}] waiting for next block before firing...`);
    await waitForNewBlock(provider);

    const nonceA = await attacker.getNonce();
    const nonceV = await victim.getNonce();

    const popFront = await router.swapExactETHForTokensSupportingFeeOnTransferTokens.populateTransaction(
      0, pathEthToTok, attacker.address, deadline, {},
    );
    const popVictim = await router.swapExactETHForTokensSupportingFeeOnTransferTokens.populateTransaction(
      0, pathEthToTok, victim.address, deadline, {},
    );
    const popBack = await router.swapExactTokensForETHSupportingFeeOnTransferTokens.populateTransaction(
      backSellAmount, 0, pathTokToEth, attacker.address, deadline, {},
    );

    const rawFront = await attacker.signTransaction({ ...popFront, value: FRONT_WETH, nonce: nonceA, ...fees(TIP_FRONT) });
    const rawVictim = await victim.signTransaction({ ...popVictim, value: VICTIM_WETH, nonce: nonceV, ...fees(TIP_VICTIM) });
    const rawBack = await attacker.signTransaction({ ...popBack, value: 0n, nonce: nonceA + 1, ...fees(TIP_BACK) });

    // ---- Fire nearly simultaneously ------------------------------------------
    const hashes: string[] = [];
    for (const raw of [rawFront, rawVictim, rawBack]) {
      hashes.push((await provider.send("eth_sendRawTransaction", [raw])) as string);
    }
    console.log(`[attempt ${attempt}] broadcast: ${hashes.map((h) => h.slice(0, 14) + "…").join(" ")}`);

    const [rcf, rcv, rcb] = await Promise.all(
      hashes.map((h) => provider.waitForTransaction(h, 1, 90_000)),
    );
    if (!rcf || !rcv || !rcb) {
      console.log(`[attempt ${attempt}] TIMEOUT awaiting receipts`);
      outcome = { ok: false, reason: "receipt timeout" };
      continue;
    }
    const statuses = [rcf.status, rcv.status, rcb.status];
    const idxs = [rcf.index, rcv.index, rcb.index];
    console.log(
      `[attempt ${attempt}] mined: blocks=${rcf.blockNumber}/${rcv.blockNumber}/${rcb.blockNumber} idx=${idxs.join("/")} status=${statuses.join("/")}`,
    );

    if (!statuses.every((s) => s === 1)) {
      outcome = { ok: false, reason: `revert statuses=${statuses}`, frontHash: rcf.hash, victimHash: rcv.hash, backHash: rcb.hash, block: rcf.blockNumber };
      continue;
    }
    const sameBlock = rcf.blockNumber === rcv.blockNumber && rcv.blockNumber === rcb.blockNumber;
    const ordered = idxs[0] < idxs[1] && idxs[1] < idxs[2];
    outcome = sameBlock && ordered
      ? { ok: true, block: rcf.blockNumber, frontHash: rcf.hash, victimHash: rcv.hash, backHash: rcb.hash }
      : { ok: false, reason: sameBlock ? `wrong order idx=${idxs.join("/")}` : "split across blocks", frontHash: rcf.hash, victimHash: rcv.hash, backHash: rcb.hash, block: rcf.blockNumber };
  }

  if (!outcome?.ok) {
    console.error("SANDWICH NOT LANDED after retries:", outcome?.reason ?? "unknown");
    process.exit(1);
  }

  saveArtifacts({
    frontRunTx: outcome.frontHash,
    victimTx: outcome.victimHash,
    backRunTx: outcome.backHash,
    blockNumber: outcome.block,
  });

  // ---- On-chain sanity: Swap/Sync logs on the victim tx ------------------------
  const rcv = await provider.getTransactionReceipt(outcome.victimHash!);
  const pairLower = String(art.pair).toLowerCase();
  const swapLogs = rcv!.logs.filter((l) => l.topics[0] === SWAP_TOPIC && l.address.toLowerCase() === pairLower);
  const syncLogs = rcv!.logs.filter((l) => l.topics[0] === SYNC_TOPIC && l.address.toLowerCase() === pairLower);
  const iface = new ethers.Interface([
    "event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)",
  ]);
  let actualOut = 0n;
  if (swapLogs.length > 0) {
    const p = iface.parseLog({ topics: [...swapLogs[0].topics], data: swapLogs[0].data })!;
    actualOut = p.args.amount1Out > 0n ? p.args.amount1Out : p.args.amount0Out;
  }

  console.log("\n=== SANDWICH LANDED ===");
  console.log(JSON.stringify(outcome, null, 2));
  console.log(`victim Swap logs on pair: ${swapLogs.length} | Sync logs: ${syncLogs.length}`);
  console.log(`victim actual MEVTEST output: ${ethers.formatEther(actualOut)}`);

  const attBal = await provider.getBalance(attacker.address);
  const vicBal = await provider.getBalance(victim.address);
  console.log(`Balances — attacker: ${ethers.formatEther(attBal)} ETH | victim: ${ethers.formatEther(vicBal)} ETH`);
}

function waitForNewBlock(provider: ethers.Provider): Promise<void> {
  return new Promise<void>((res) => {
    const h = () => {
      provider.off?.("block", h as never);
      res();
    };
    provider.on("block", h);
  });
}

if (process.argv[1] && process.argv[1].endsWith("run-sandwich.ts")) {
  main().catch((e) => {
    console.error("SANDWICH FAILED:", e.message ?? e);
    process.exit(1);
  });
}

