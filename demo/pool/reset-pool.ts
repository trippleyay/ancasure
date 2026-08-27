/**
 * Reset the WETH/MEVTEST pool to canonical reserves 0.03 WETH / 40,000 MEVTEST.
 *
 * NOTE: after round-1 cleanup the pair's totalSupply is only the 1000-wei
 * MINIMUM_LIQUIDITY locked at address(0), and residual reserves are pinned by
 * the K invariant — a router remove+re-add cycle cannot reach zero reserves.
 * Instead we DONATE exact deltas directly to the pair and call sync():
 *   transfer(40000e18 - rTok, MEVTEST) ; transfer(0.03e18 - rWETH, WETH) ; pair.sync()
 * Reserves then match canonical exactly. Idempotent (deltas from live state).
 * LP ownership is irrelevant for the demo (attacker trades, not provides).
 *   npx tsx scripts/sandwich-demo/reset-pool.ts
 */
import { ethers } from "ethers";
import {
  log,
  getProvider,
  getMasterWallet,
  loadArtifacts,
  retry,
  WETH,
  ERC20_ABI,
  WETH_ABI,
  PAIR_ABI,
  POOL_WETH,
  MINT_MEVTEST,
} from "../lib";

const TX_OPTS = {
  maxFeePerGas: ethers.parseUnits("40", "gwei"),
  maxPriorityFeePerGas: ethers.parseUnits("3", "gwei"),
};

const CANON_TOKEN = MINT_MEVTEST / 25n; // 40,000e18

export async function main(): Promise<void> {
  const provider = getProvider();
  const master = getMasterWallet(provider);
  const art = loadArtifacts();
  const tokenAddr = art.mevTestToken!;
  const pairAddr = art.pair!;
  if (!tokenAddr || !pairAddr) throw new Error("artifacts.json missing token/pair");

  const weth = new ethers.Contract(WETH, WETH_ABI, master);
  const tok = new ethers.Contract(tokenAddr, ERC20_ABI, master);
  const pair = new ethers.Contract(
    pairAddr,
    [...PAIR_ABI, "function sync()", "function totalSupply() view returns (uint256)"],
    master,
  );

  async function snapshot(): Promise<{ rWeth: bigint; rTok: bigint }> {
    const [r0, r1] = (await retry("reserves", () => pair.getReserves())) as [bigint, bigint];
    const t0 = String(await retry("token0", () => pair.token0()));
    return {
      rWeth: t0.toLowerCase() === WETH.toLowerCase() ? r0 : r1,
      rTok: t0.toLowerCase() === WETH.toLowerCase() ? r1 : r0,
    };
  }

  let { rWeth, rTok } = await snapshot();
  log(`Current reserves: ${ethers.formatEther(rWeth)} WETH / ${ethers.formatEther(rTok)} MEVTEST`);

  if (rWeth > POOL_WETH || rTok > CANON_TOKEN) {
    throw new Error(
      `Pool above canonical (${rWeth}/${rTok} > ${POOL_WETH}/${CANON_TOKEN}) — donate approach cannot shrink`,
    );
  }

  const dWeth = POOL_WETH - rWeth;
  const dTok = CANON_TOKEN - rTok;

  if (dWeth > 0n || dTok > 0n) {
    if ((await provider.getBalance(master.address)) < ethers.parseEther("0.001")) {
      throw new Error("Master ETH too low for gas");
    }
    if (dWeth > 0n) {
      const have: bigint = await weth.balanceOf(master.address);
      if (have < dWeth) throw new Error(`Need ${ethers.formatEther(dWeth)} WETH, hold ${ethers.formatEther(have)}`);
      const tx = await retry("weth.transfer:broadcast", () =>
        weth.transfer(pairAddr, dWeth, { ...TX_OPTS, gasLimit: 120_000 }));
      await retry("weth.transfer:wait", async () => {
        const r = await tx.wait();
        if (!r || r.status !== 1) throw new Error("weth transfer status!=1");
        log(`WETH donation ${ethers.formatEther(dWeth)}: block ${r.blockNumber}, tx ${r.hash}`);
        return r;
      });
    }
    if (dTok > 0n) {
      const have: bigint = await tok.balanceOf(master.address);
      if (have < dTok) throw new Error(`Need ${ethers.formatEther(dTok)} MEVTEST, hold ${ethers.formatEther(have)}`);
      const tx = await retry("tok.transfer:broadcast", () =>
        tok.transfer(pairAddr, dTok, { ...TX_OPTS, gasLimit: 120_000 }));
      await retry("tok.transfer:wait", async () => {
        const r = await tx.wait();
        if (!r || r.status !== 1) throw new Error("tok transfer status!=1");
        log(`MEVTEST donation ${ethers.formatEther(dTok)}: block ${r.blockNumber}, tx ${r.hash}`);
        return r;
      });
    }
    const sy = await retry("sync:broadcast", () => pair.sync({ ...TX_OPTS, gasLimit: 80_000 }));
    await retry("sync:wait", async () => {
      const r = await sy.wait();
      if (!r || r.status !== 1) throw new Error("sync status!=1");
      log(`pair.sync(): block ${r.blockNumber}, tx ${r.hash}`);
      return r;
    });
  } else {
    log("Reserves already at canonical values");
  }

  ({ rWeth, rTok } = await snapshot());
  if (rWeth !== POOL_WETH || rTok !== CANON_TOKEN) {
    throw new Error(`Reserves mismatch after sync: ${rWeth}/${rTok}`);
  }
  log(`FINAL reserves — WETH=${ethers.formatEther(rWeth)} MEVTEST=${ethers.formatEther(rTok)} (exact match)`);
  log(`Master ETH=${ethers.formatEther(await provider.getBalance(master.address))} WETH=${ethers.formatEther(await weth.balanceOf(master.address))}`);
}

if (process.argv[1] && process.argv[1].endsWith("reset-pool.ts")) {
  main().catch((e) => {
    console.error("RESET FAILED:", e.message ?? e);
    process.exit(1);
  });
}

