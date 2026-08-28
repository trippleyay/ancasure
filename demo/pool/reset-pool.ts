/**
 * Reset the WETH/MEVTEST pool toward canonical reserves 0.03 WETH / 40,000 MEVTEST.
 *
 * Two mechanisms, chosen per side:
 *  - GROW (below canonical): DONATE exact deltas directly to the pair and call
 *    sync() (LP supply is just the 1000-wei MINIMUM_LIQUIDITY, so LP burn is
 *    useless; donation is exact and cheap). Auto-wraps ETH for the WETH side.
 *  - SHRINK (above canonical): the V2 "K" invariant forbids reducing the
 *    reserves product, so exact canonical can be unreachable. We pull the
 *    excess out with a DIRECT low-level pair.swap() (no router, no fee) up to
 *    the K limit: tokAfter = k / WETH_target. Received excess MEVTEST lands in
 *    the master wallet (handily seeding the back-run inventory). Drift from
 *    canonical is reported as a warning — the demo always reads LIVE reserves.
 *   npx tsx demo/pool/reset-pool.ts
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
    [...PAIR_ABI, "function sync()", "function swap(uint256,uint256,address,bytes)"],
    master,
  );

  async function snapshot(): Promise<{ rWeth: bigint; rTok: bigint; k: bigint }> {
    const [r0, r1] = (await retry("reserves", () => pair.getReserves())) as [bigint, bigint];
    const t0 = String(await retry("token0", () => pair.token0()));
    const rWeth = t0.toLowerCase() === WETH.toLowerCase() ? r0 : r1;
    const rTok = t0.toLowerCase() === WETH.toLowerCase() ? r1 : r0;
    return { rWeth, rTok, k: r0 * r1 };
  }
  const isTokToken0 =
    String(await retry("token0", () => pair.token0())).toLowerCase() === tokenAddr.toLowerCase();

  async function waitTx(label: string, tx: ethers.ContractTransactionResponse) {
    return retry(`${label}:wait`, async () => {
      const r = await tx.wait();
      if (!r || r.status !== 1) throw new Error(`${label} status!=1`);
      log(`${label}: block ${r.blockNumber}, tx ${r.hash}`);
      return r;
    });
  }

  let { rWeth, rTok, k } = await snapshot();
  log(`Current reserves: ${ethers.formatEther(rWeth)} WETH / ${ethers.formatEther(rTok)} MEVTEST`);
  if ((await provider.getBalance(master.address)) < ethers.parseEther("0.001")) {
    throw new Error("Master ETH too low for gas");
  }

  // ---- Phase 1: GROW the WETH side (direct transfer, NO sync yet) ----------
  // V2's swap() K-check compares ACTUAL token balances against the STORED
  // reserves, so an unsynced WETH donation raises the balance side without
  // raising the stored K — enabling the Phase-2 shrink in the same sequence.
  const dWeth = POOL_WETH > rWeth ? POOL_WETH - rWeth : 0n;
  let donated = false;
  if (dWeth > 0n) {
    let have: bigint = await weth.balanceOf(master.address);
    if (have < dWeth) {
      const need = dWeth - have;
      log(`Wrapping ${ethers.formatEther(need)} ETH -> WETH`);
      const dp = await retry("weth.deposit:broadcast", () =>
        weth.deposit({ value: need, ...TX_OPTS, gasLimit: 80_000 }));
      await waitTx("weth.deposit", dp);
    }
    const tx = await retry("weth.transfer:broadcast", () =>
      weth.transfer(pairAddr, dWeth, { ...TX_OPTS, gasLimit: 120_000 }));
    await waitTx("WETH donation (unsynced)", tx);
    donated = true;
  }

  // ---- Phase 2: SHRINK the MEVTEST side to the K-invariant limit -----------
  // K check at swap time: POOL_WETH * tokAfter >= kStored (stored reserves).
  let swapped = false;
  {
    const tokAfterMax = k / POOL_WETH; // floor; k = STORED reserves product
    const tokAfterMin = tokAfterMax * POOL_WETH < k ? tokAfterMax + 1n : tokAfterMax; // ceil
    const targetTok = tokAfterMin > CANON_TOKEN ? tokAfterMin : CANON_TOKEN;
    const out = rTok > targetTok ? rTok - targetTok : 0n;
    if (out > 0n) {
      log(`Pulling ${ethers.formatEther(out)} MEVTEST out via direct pair.swap() (K-limited)`);
      const tx = await retry("swap:broadcast", () =>
        isTokToken0
          ? pair.swap(out, 0, master.address, "0x", { ...TX_OPTS, gasLimit: 160_000 })
          : pair.swap(0, out, master.address, "0x", { ...TX_OPTS, gasLimit: 160_000 }));
      await waitTx("MEVTEST shrink swap", tx);
      swapped = true;
    }
  }

  // ---- Phase 3: fold donations into stored reserves ------------------------
  if (donated && !swapped) {
    const sy = await retry("sync:broadcast", () => pair.sync({ ...TX_OPTS, gasLimit: 80_000 }));
    await waitTx("pair.sync", sy);
  }

  // ---- Final report --------------------------------------------------------
  const fin = await snapshot();
  if (fin.rWeth !== POOL_WETH || fin.rTok !== CANON_TOKEN) {
    const drift = fin.rTok > CANON_TOKEN
      ? (Number(ethers.formatEther(fin.rTok - CANON_TOKEN)) / Number(ethers.formatEther(CANON_TOKEN))) * 100
      : 0;
    log(
      `WARNING: near-canonical (V2 K invariant limits shrinking): ` +
      `WETH=${ethers.formatEther(fin.rWeth)} MEVTEST=${ethers.formatEther(fin.rTok)} ` +
      `(MEVTEST drift +${drift.toFixed(3)}%). The demo reads live reserves — this is fine.`,
    );
  } else {
    log(`FINAL reserves — WETH=${ethers.formatEther(fin.rWeth)} MEVTEST=${ethers.formatEther(fin.rTok)} (exact match)`);
  }
  log(
    `Master ETH=${ethers.formatEther(await provider.getBalance(master.address))} ` +
    `WETH=${ethers.formatEther(await weth.balanceOf(master.address))} ` +
    `MEVTEST=${ethers.formatEther(await tok.balanceOf(master.address))}`,
  );
}

if (process.argv[1] && process.argv[1].endsWith("reset-pool.ts")) {
  main().catch((e) => {
    console.error("RESET FAILED:", e.message ?? e);
    process.exit(1);
  });
}

