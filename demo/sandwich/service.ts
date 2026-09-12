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

export interface MempoolWatch {
  id: string;
  /** Unsigned victim swap the victim broadcasts THEMSELVES (normal wallet send). */
  swap: { to: string; valueWei: string; data: string; suggestedTipGwei: string };
  status(): { done: boolean; seenVictim: boolean; outcome?: TrioOutcome };
  promise: Promise<TrioOutcome>;
}

/**
 * Desktop browser wallets (MetaMask extension) no longer support
 * eth_signTransaction, so the judge cannot hand over a pre-signed raw victim
 * tx. Instead the victim broadcasts their OWN swap with a 12.01 gwei tip while
 * this watcher polls the mempool (pending block); the moment the victim tx is
 * seen, attacker front (12.02 tip) and back (12.00 tip) are broadcast —
 * builders order by tip: [front][victim][back], same block, identical
 * mechanics to the golden run. If the block closes before the attacker lands,
 * the attempt reports failure honestly (receipts read back, never fabricated).
 */
export async function startMempoolSandwich(
  provider: ethers.Provider & { send: (m: string, p: unknown[]) => Promise<unknown> },
  attackerWallet: ethers.Wallet,
  victimAddress: string,
  opts: { pair?: string; mevTestToken?: string; timeoutMs?: number; say?: (m: string) => void } = {},
): Promise<MempoolWatch> {
  const say = opts.say ?? log;
  const art = loadArtifacts();
  const tokenAddr = opts.mevTestToken ?? art.mevTestToken!;
  const pairAddr = opts.pair ?? art.pair!;
  if (!tokenAddr || !pairAddr) throw new Error("Run setup-pool.ts first");

  let seenVictim = false;
  let outcome: TrioOutcome | undefined;

  // Plan and victim swap BEFORE returning — the caller needs the swap params
  // immediately (the victim broadcasts them from their own browser wallet).
  const plan = await planAttempt(provider, pairAddr, tokenAddr);
  if (plan.predictedLossBps < 100n || plan.predictedLossBps > 1200n) {
    throw new Error(`predicted loss ${(Number(plan.predictedLossBps) / 100).toFixed(2)}% outside safety band`);
  }
  const victimSwap = await buildVictimSwapRequest(victimAddress, tokenAddr);

  const watch: MempoolWatch = {
    id: crypto.randomUUID(),
    swap: victimSwap,
    status: () => ({ done: !!outcome, seenVictim, outcome }),
    promise: (async () => {
      const router = new ethers.Contract(ROUTER, ROUTER_ABI, attackerWallet);
      const chainId = (await provider.getNetwork()).chainId;
      const dataMatch = victimSwap.data.toLowerCase();

      const latest = await retry("getBlock", () => provider.getBlock("latest"));
      const baseFee = latest?.baseFeePerGas ?? ethers.parseUnits("15", "gwei");
      const fees = (tip: bigint) => ({
        maxPriorityFeePerGas: tip,
        maxFeePerGas: baseFee * 2n + tip,
        gasLimit: GAS_SWAP,
        type: 2 as const,
        chainId,
      });

      const deadline = Date.now() + (opts.timeoutMs ?? 180_000);
      say(`[watch ${watch.id.slice(0, 8)}] watching mempool for victim swap from ${victimAddress}...`);
      let victimHash = "";
      while (Date.now() < deadline && !victimHash) {
        await new Promise((r) => setTimeout(r, 1500));
        const pending: any = await provider.send("eth_getBlockByNumber", ["pending", true]);
        for (const tx of pending?.transactions ?? []) {
          if (
            String(tx.from).toLowerCase() === victimAddress.toLowerCase() &&
            String(tx.input).toLowerCase() === dataMatch
          ) {
            victimHash = tx.hash;
            seenVictim = true;
            say(`[watch] victim tx spotted in mempool: ${victimHash}`);
            break;
          }
        }
      }
      if (!victimHash) {
        outcome = { ok: false, reason: "victim swap not seen in mempool before timeout" };
        return outcome;
      }

      const nonceA = await attackerWallet.getNonce();
      const popFront = await router.swapExactETHForTokensSupportingFeeOnTransferTokens.populateTransaction(
        0, [WETH, tokenAddr], attackerWallet.address, Math.floor(Date.now() / 1000) + 120, {},
      );
      const popBack = await router.swapExactTokensForETHSupportingFeeOnTransferTokens.populateTransaction(
        plan.backSellAmount, 0, [tokenAddr, WETH], attackerWallet.address, Math.floor(Date.now() / 1000) + 120, {},
      );
      const rawFront = await attackerWallet.signTransaction({ ...popFront, value: FRONT_WETH, nonce: nonceA, ...fees(ethers.parseUnits("12.02", "gwei")) });
      const rawBack = await attackerWallet.signTransaction({ ...popBack, value: 0n, nonce: nonceA + 1, ...fees(ethers.parseUnits("12.00", "gwei")) });

      const frontHash = (await provider.send("eth_sendRawTransaction", [rawFront])) as string;
      const backHash = (await provider.send("eth_sendRawTransaction", [rawBack])) as string;
      say(`[watch] broadcast front=${frontHash.slice(0, 14)}… back=${backHash.slice(0, 14)}…`);

      const receipts = await Promise.all([
        provider.waitForTransaction(frontHash, 1, 90_000),
        provider.waitForTransaction(victimHash, 1, 90_000),
        provider.waitForTransaction(backHash, 1, 90_000),
      ]);
      const [rcf, rcv, rcb] = receipts;
      if (!rcf || !rcv || !rcb) {
        outcome = { ok: false, reason: "receipt timeout", frontHash, victimHash, backHash };
        return outcome;
      }
      const sameBlock = rcf.blockNumber === rcv.blockNumber && rcv.blockNumber === rcb.blockNumber;
      const ordered = rcf.index < rcv.index && rcv.index < rcb.index;
      outcome = sameBlock && ordered && rcf.status === 1 && rcv.status === 1 && rcb.status === 1
        ? { ok: true, block: rcf.blockNumber, frontHash: rcf.hash, victimHash: rcv.hash, backHash: rcb.hash }
        : {
            ok: false,
            reason: `statuses=${[rcf.status, rcv.status, rcb.status].join(",")} ${sameBlock ? (ordered ? "" : "wrong order") : "split blocks"}`,
            frontHash: rcf.hash, victimHash: rcv.hash, backHash: rcb.hash, block: rcf.blockNumber,
          };
      say(`[watch] outcome: ${JSON.stringify(outcome)}`);
      return outcome;
    })(),
  };
  return watch;
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
