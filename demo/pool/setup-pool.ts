/**
 * Step 2 — verify official contracts, create WETH/MEVTEST pair via the official
 * V2 Factory, add minimal liquidity through Router02, fund the deterministic
 * victim wallet, and pre-approve the router so the back-run can fire on attempt 1.
 *   npx tsx scripts/sandwich-demo/setup-pool.ts
 */
import * as fs from "fs";
import { ethers } from "ethers";
import {
  log,
  getProvider,
  getMasterWallet,
  deriveChildKey,
  saveArtifacts,
  loadArtifacts,
  retry,
  FACTORY,
  ROUTER,
  WETH,
  ERC20_ABI,
  WETH_ABI,
  FACTORY_ABI,
  ROUTER_ABI,
  PAIR_ABI,
  POOL_WETH,
  MINT_MEVTEST,
  VICTIM_FUNDING,
} from "../lib";

const TX_OPTS = {
  maxFeePerGas: ethers.parseUnits("40", "gwei"),
  maxPriorityFeePerGas: ethers.parseUnits("3", "gwei"),
};

log(`BOOT setup-pool2 argv: ${process.argv[1]}`);

type TxB = ethers.TransactionResponse;
const receipts = new Map<string, Promise<ethers.TransactionReceipt | null>>();

/** Broadcasts via builder-thunk (retryable), then awaits receipt (memoized). */
async function send(label: string, build: () => Promise<TxB>): Promise<ethers.TransactionReceipt> {
  const tx = await retry(`${label}:broadcast`, build);
  const rc = await retry(`${label}:wait`, async () => {
    if (!receipts.has(tx.hash)) receipts.set(tx.hash, tx.wait());
    const r = await receipts.get(tx.hash)!;
    if (!r || r.status !== 1) throw new Error(`${label} status!=1`);
    return r;
  });
  log(`${label}: block ${rc.blockNumber}, tx ${rc.hash}, gasUsed ${rc.gasUsed}`);
  return rc;
}

export async function main(): Promise<void> {
  const provider = getProvider();
  const master = getMasterWallet(provider); // == attacker
  const artifacts = loadArtifacts();
  const tokenAddr = artifacts.mevTestToken!;
  if (!tokenAddr) throw new Error("Run deploy-token.ts first");

  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, master);
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, master);
  const weth = new ethers.Contract(WETH, WETH_ABI, master);

  const feeSetter = await retry("feeToSetter", () => factory.feeToSetter());
  log(`Factory ${FACTORY} verified (feeToSetter=${feeSetter})`);

  // --- Create pair via OFFICIAL factory ---
  let pair = await retry("getPair", () => factory.getPair(WETH, tokenAddr));
  if (pair === ethers.ZeroAddress) {
    const rc = await send("createPair", () => factory.createPair(WETH, tokenAddr, { ...TX_OPTS, gasLimit: 4_500_000 }));
    const ev = rc.logs
      .map((l) => factory.interface.parseLog({ topics: [...l.topics], data: l.data }))
      .find((p) => p?.name === "PairCreated");
    pair = ev!.args.pair as string;
  }
  log(`Pair: ${pair}`);
  saveArtifacts({ pair });

  // --- Budget guard ---
  const balBefore = await retry("bal", () => provider.getBalance(master.address));
  log(`Attacker balance: ${ethers.formatEther(balBefore)} ETH (pool needs ${ethers.formatEther(POOL_WETH)})`);
  if (balBefore < POOL_WETH + ethers.parseEther("0.02")) {
    throw new Error("Insufficient balance for pool + minimum operating gas — refusing to drain wallet");
  }

  // --- Idempotent WETH deposit (skip if router allowance already covers it) ---
  const wethBal = await retry("weth bal", () => weth.balanceOf(master.address));
  const wethAllowance = await retry("weth allowance", () => weth.allowance(master.address, ROUTER));
  if (wethAllowance < POOL_WETH) {
    if (wethBal < POOL_WETH) {
      await send("WETH.deposit", () => weth.deposit({ value: POOL_WETH, ...TX_OPTS, gasLimit: 80_000 }));
    }
    await send("approve WETH", () => weth.approve(ROUTER, ethers.MaxUint256, { ...TX_OPTS, gasLimit: 90_000 }));
  }

  // --- Idempotent approvals (skip if already MAX) ---
  const mev = new ethers.Contract(tokenAddr, ERC20_ABI, master);
  const mevAllowance = await retry("mev allowance", () => mev.allowance(master.address, ROUTER));
  if (mevAllowance < MINT_MEVTEST / 25n) {
    await send("approve MEVTEST", () => mev.approve(ROUTER, ethers.MaxUint256, { ...TX_OPTS, gasLimit: 90_000 }));
  }

  // --- Idempotent liquidity: skip if pair already has reserves ---
  const pairC0 = new ethers.Contract(pair, PAIR_ABI, provider);
  let [r0, r1] = await retry("reserves", () => pairC0.getReserves());
  if (r0 === 0n && r1 === 0n) {
    const deadline = Math.floor(Date.now() / 1000) + 600;
    const liqTx = await send(
      "addLiquidityETH",
      () => router.addLiquidityETH(tokenAddr, MINT_MEVTEST / 25n, 0, 0, master.address, deadline, {
        ...TX_OPTS, value: POOL_WETH, gasLimit: 500_000,
      }),
    );
    saveArtifacts({ liquidityTx: liqTx.hash });
    [r0, r1] = await retry("reserves2", () => pairC0.getReserves());
  } else {
    log(`Pair already initialized (reserves ${r0}/${r1}) — skipping addLiquidityETH`);
  }

  // --- Dust purchase only if attacker holds no MEVTEST yet (back-run allowance) ---
  const dustBal = await retry("attacker mev bal", () => mev.balanceOf(master.address));
  if (dustBal === 0n) {
    const deadline2 = Math.floor(Date.now() / 1000) + 600;
    await send(
      "dust buy",
      () => router.swapExactETHForTokensSupportingFeeOnTransferTokens(0, [WETH, tokenAddr], master.address, deadline2, {
        ...TX_OPTS, value: ethers.parseEther("0.0002"), gasLimit: 300_000,
      }),
    );
  } else {
    log(`Attacker already holds ${ethers.formatEther(dustBal)} MEVTEST — skipping dust buy`);
  }

  // --- Fund deterministic victim wallet ---
  const victim = new ethers.Wallet(deriveChildKey("mev-shield-victim"), provider);
  const vBal = await retry("victim bal", () => provider.getBalance(victim.address));
  if (vBal < VICTIM_FUNDING / 2n) {
    await send("fund victim", () => master.sendTransaction({ to: victim.address, value: VICTIM_FUNDING, ...TX_OPTS, gasLimit: 21_000 }));
  }
  log(`Victim ${victim.address}: ${ethers.formatEther(await provider.getBalance(victim.address))} ETH`);
  saveArtifacts({ attacker: master.address, victim: victim.address });

  const t0 = String(await retry("token0", () => pairC0.token0()));
  const w0 = t0.toLowerCase() === WETH.toLowerCase();
  log(`Reserves — WETH=${ethers.formatEther(w0 ? r0 : r1)} MEVTEST=${ethers.formatEther(w0 ? r1 : r0)}`);
}

if (process.argv[1] && process.argv[1].endsWith("setup-pool.ts")) {
  main().catch((e) => {
    fs.writeSync(2, "SETUP FAILED: " + String(e && (e as Error).message ? (e as Error).message : e) + "\n");
    process.exit(1);
  });
}
