/**
 * Reusable controlled-sandwich service (judge-wallet flow).
 *
 * Same broadcast technique as the proven run-sandwich.ts CLI, generalized so
 * the VICTIM transaction is supplied pre-signed by the caller (in production,
 * the judge's browser wallet — per docs/demo.md steps 3-5).
 *
 * Ordering control (unchanged from the validated implementation):
 *   on a fresh block we broadcast three PRE-SIGNED transactions nearly
 *   simultaneously with DESCENDING priority tips so builders pack
 *       [front 12.02][victim 12.01][back 12.00] gwei.
 * Attacker front/back share one account with consecutive nonces. If ordering
 * fails, amounts are recomputed from live reserves and the attempt retried.
 * NOTHING is fabricated: orderings are read back from real receipts.
 */
import { ethers } from "ethers";
import {
  log,
  loadArtifacts,
  retry,
  WETH,
  ROUTER_ABI,
  PAIR_ABI,
  ROUTER,
  FRONT_WETH,
  VICTIM_WETH,
  v2GetAmountOut,
} from "../lib";

const MAX_ATTEMPTS = 6;
const GAS_SWAP = 350_000;

export interface TrioOutcome {
  ok: boolean;
  reason?: string;
  block?: number;
  frontHash?: string;
  victimHash?: string;
  backHash?: string;
}

export interface AttemptPlan {
  rin: bigint;
  rout: bigint;
  frontOut: bigint;
  cfOut: bigint;
  vicOut: bigint;
  backSellAmount: bigint;
  predictedLossBps: bigint;
}

/** Reconstruct current pool state and planned amounts for one attempt. */
export async function planAttempt(
  provider: ethers.Provider,
  pairAddress: string,
  mevTestToken: string,
): Promise<AttemptPlan> {
  const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
  const [r0, r1] = await retry("reserves", () => pair.getReserves());
  const wethIs0 = String(await pair.token0()).toLowerCase() === WETH.toLowerCase();
  const rin = wethIs0 ? r0 : r1;
  const rout = wethIs0 ? r1 : r0;

  const frontOut = v2GetAmountOut(FRONT_WETH, rin, rout);
  const cfOut = v2GetAmountOut(VICTIM_WETH, rin, rout); // counterfactual
  const vicOut = v2GetAmountOut(VICTIM_WETH, rin + FRONT_WETH, rout - frontOut);
  const backSellAmount = (frontOut * 9995n) / 10000n; // -0.05% safety, golden technique

  return {
    rin,
    rout,
    frontOut,
    cfOut,
    vicOut,
    backSellAmount,
    predictedLossBps: ((cfOut - vicOut) * 10000n) / cfOut,
  };
}

/** Unsigned victim swap for the JUDGE's wallet (frontend signs exactly this). */
export async function buildVictimSwapRequest(
  judgeAddress: string,
  mevTestToken: string,
): Promise<{ to: string; valueWei: string; data: string; suggestedTipGwei: string }> {
  const routerIface = new ethers.Interface([
    "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] path, address to, uint deadline) payable",
  ]);
  const data = routerIface.encodeFunctionData(
    "swapExactETHForTokensSupportingFeeOnTransferTokens",
    [0, [WETH, mevTestToken], judgeAddress, Math.floor(Date.now() / 1000) + 120],
  );
  return {
    to: ROUTER,
    valueWei: VICTIM_WETH.toString(),
    data,
    suggestedTipGwei: "12.01", // must sit between attacker tips for adjacency
  };
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

export interface ExecuteOptions {
  provider: ethers.Provider & { send: (m: string, p: unknown[]) => Promise<unknown> };
  attackerWallet: ethers.Wallet;
  /** Per-attempt source of the JUDGE-SIGNED victim raw transaction. */
  getVictimRawTx: () => Promise<string>;
  pair?: string;
  mevTestToken?: string;
  maxAttempts?: number;
  /** Log sink override (API passes through to its own logger). */
  say?: (m: string) => void;
}

/** Executes the controlled sandwich around the caller-supplied victim tx. */
export async function executeControlledSandwich(opts: ExecuteOptions): Promise<TrioOutcome> {
  const provider = opts.provider;
  const attacker = opts.attackerWallet.connect(provider) as ethers.Wallet;
  const art = loadArtifacts();
  const tokenAddr = opts.mevTestToken ?? art.mevTestToken!;
  const pairAddr = opts.pair ?? art.pair!;
  if (!tokenAddr || !pairAddr) throw new Error("Run setup-pool.ts first");
  const say = opts.say ?? log;

  const router = new ethers.Contract(ROUTER, ROUTER_ABI, attacker);
  const chainId = (await provider.getNetwork()).chainId;
  let outcome: TrioOutcome | null = null;

  for (let attempt = 1; attempt <= (opts.maxAttempts ?? MAX_ATTEMPTS) && !outcome?.ok; attempt++) {
    const deadline = Math.floor(Date.now() / 1000) + 120;
    const plan = await planAttempt(provider, pairAddr, tokenAddr);
    if (plan.predictedLossBps < 100n || plan.predictedLossBps > 1200n) {
      throw new Error(`predicted loss ${(Number(plan.predictedLossBps) / 100).toFixed(2)}% outside safety band`);
    }

    const latest = await retry("getBlock", () => provider.getBlock("latest"));
    const baseFee = latest?.baseFeePerGas ?? ethers.parseUnits("15", "gwei");
    const fees = (tip: bigint) => ({
      maxPriorityFeePerGas: tip,
      maxFeePerGas: baseFee * 2n + tip,
      gasLimit: GAS_SWAP,
      type: 2 as const,
      chainId,
    });

    say(`[attempt ${attempt}] waiting for next block...`);
    await waitForNewBlock(provider);

    const nonceA = await attacker.getNonce();
    const popFront = await router.swapExactETHForTokensSupportingFeeOnTransferTokens.populateTransaction(
      0, [WETH, tokenAddr], attacker.address, deadline, {},
    );
    const popBack = await router.swapExactTokensForETHSupportingFeeOnTransferTokens.populateTransaction(
      plan.backSellAmount, 0, [tokenAddr, WETH], attacker.address, deadline, {},
    );

    // Victim tx arrives pre-signed by the judge (tip suggested at 12.01 gwei).
    const rawVictim = await opts.getVictimRawTx();

    const rawFront = await attacker.signTransaction({ ...popFront, value: FRONT_WETH, nonce: nonceA, ...fees(ethers.parseUnits("12.02", "gwei")) });
    const rawBack = await attacker.signTransaction({ ...popBack, value: 0n, nonce: nonceA + 1, ...fees(ethers.parseUnits("12.00", "gwei")) });

    const hashes: string[] = [];
    for (const raw of [rawFront, rawVictim, rawBack]) {
      hashes.push((await provider.send("eth_sendRawTransaction", [raw])) as string);
    }
    say(`[attempt ${attempt}] broadcast: ${hashes.map((h) => h.slice(0, 14) + "…").join(" ")}`);

    const receipts = await Promise.all(hashes.map((h) => provider.waitForTransaction(h, 1, 90_000)));
    if (!receipts[0] || !receipts[1] || !receipts[2]) {
      outcome = { ok: false, reason: "receipt timeout" };
      continue;
    }
    const [rcf, rcv, rcb] = receipts;
    const statuses = [rcf.status, rcv.status, rcb.status];
    const idxs = [rcf.index, rcv.index, rcb.index];
    say(`[attempt ${attempt}] mined: blocks=${rcf.blockNumber}/${rcv.blockNumber}/${rcb.blockNumber} idx=${idxs.join("/")} status=${statuses.join("/")}`);

    const sameBlock = rcf.blockNumber === rcv.blockNumber && rcv.blockNumber === rcb.blockNumber;
    const ordered = idxs[0] < idxs[1] && idxs[1] < idxs[2];
    outcome = sameBlock && ordered && statuses.every((s) => s === 1)
      ? { ok: true, block: rcf.blockNumber, frontHash: rcf.hash, victimHash: rcv.hash, backHash: rcb.hash }
      : { ok: false, reason: `statuses=${statuses.join(",")} ${sameBlock ? (ordered ? "" : "wrong order") : "split blocks"}`, frontHash: rcf.hash, victimHash: rcv.hash, backHash: rcb.hash, block: rcf.blockNumber };
  }
  return outcome!;
}
