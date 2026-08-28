# Controlled Demo Walkthrough

All commands run from the repository root after `npm install && cp .env.example .env`.

## One-time environment

The MEVTEST token and its WETH/MEVTEST pair were **already deployed and
golden-validated** — there is no need (and no reason) to deploy a new token.
Seed the local artifact registry offline (no gas, no RPC):

```bash
npx tsx scripts/seed-artifacts.ts       # writes data/demo/artifacts.json from the proven addresses
```

Only if the pool has drifted from its canonical state (0.03 WETH / 40,000
MEVTEST) or liquidity was never seeded on this chain state, canonicalize it:

```bash
npx tsx demo/pool/reset-pool.ts         # donate deltas + sync → canonical reserves
```

> **Pool-drift note:** the V2 `K` invariant is monotonic — a pool that once held
> more MEVTEST can never shrink below `K / 0.03 WETH` on the token side. When
> that floor sits above 40,000 MEVTEST the script pulls out everything K allows
> and reports the residual drift as a WARNING. This is harmless: the WETH side
> (the one that determines the victim's loss % and the attacker's profit) is
> restored exactly to canonical, and every demo/simulator step reads **live**
> reserves, never the canonical constants.

(For a brand-new chain/environment only: `demo/token/deploy-token.ts` and
`demo/pool/setup-pool.ts` remain available, but they are NOT part of the normal
demo path.)
```

Artifacts (addresses, hashes — no secrets) land in `data/demo/artifacts.json`.

The judge wallet needs Sepolia ETH for gas + trade size (faucets); the backend
can top it up: `npx tsx demo/pool/topup.ts <judgeAddress> <amountEth>`.

## End-to-end flow

1. Judge opens `apps/web`, connects wallet.
2. *Register protection* — frontend calls `POST /protect` → `registerProtection(cap)` on the deployed `AncaSureClaims`.
3. *Protected swap* — `GET /api/swap-tx?valueEth=0.0024` returns an unsigned victim swap (router path WETH→MEVTEST, minOut=1). Judge signs it in-browser and POSTs the signed tx.
4. Backend holds the signed victim tx, pre-signs front-run (12.02 gwei tip) and back-run (12.00 gwei), waits for a fresh block and broadcasts all three nearly simultaneously — builders pack them by descending priority fee: **[front][victim][back]** (identical mechanics to the validated golden run).
5. On confirmation all three hashes + block/index are recorded (`data/demo/run-latest.json`) and echoed back.
6. `POST /detect {victimTxHash}` → detector classifies the run.
7. `POST /simulate {victimTxHash}` → verified counterfactual loss.
8. `POST /verify {chain, txHashes:[front,victim,back]}` → Creditcoin/Attestcoin proofs built + statically verified on-chain.
9. `POST /claim` → authorizer submits `submitVerifiedClaim(judge, loss, victimTxHash)`; once mined, judge calls/payments execute via `payClaim`.

CLI equivalent of steps 3–5 for development (uses the deterministic dev-victim wallet — fixtures only, not the final judge flow):

```bash
npx tsx demo/sandwich/run-sandwich.ts            # golden-mechanics sandwich
npm run detect -- 0x<VICTIM_HASH>
npm run simulate -- 0x<VICTIM_HASH>
```

### Reliability & sizing

The sandwich is designed for **unattended, repeatable runs** (click → attack →
output):

* every pre-flight RPC call (reserves, balances, funding) is retry-wrapped for
  transient Alchemy timeouts;
* attack sizes are computed from the **live** reserves each run — the demo never
  decays as the pool grows and can be repeated indefinitely;
* the victim wallet is topped up idempotently (only to trade size + gas
  headroom; unused headroom carries over to the next run);
* attacker sizes are scaled down automatically if the wallet balance is short.

Severity is tunable via `SANDWICH_PROFILE` (exact V2 math, per-run cost ≈
front + victim + gas):

| profile    | front/victim (of live reserve) | victim loss | cost/run  |
|------------|-------------------------------|-------------|-----------|
| `gentle`   | 10% / 20%                     | ~16%        | ~0.013 ETH |
| `moderate` | 30% / 60% (default)           | ~35%        | ~0.032 ETH |
| `brutal`   | 100% / 100%                   | ~67%        | ~0.067 ETH |

e.g. `SANDWICH_PROFILE=brutal npx tsx demo/sandwich/run-sandwich.ts`

### Using a judge's own wallet as the victim

Set `VICTIM_PRIVATE_KEY` in `.env` (or the environment) and the sandwich uses
that wallet as the victim instead of the derived dev-victim:

```bash
VICTIM_PRIVATE_KEY=0x<judge-test-key> npm run demo:sandwich
```

Notes:

* the script only ever **tops up** the victim wallet (trade size + gas
  headroom) — it never moves funds out of it;
* the key is read from the environment, never logged, and never written to
  `data/demo/artifacts.json` (which records only the victim *address* and the
  victim tx hash);
* use a throwaway **testnet-only** key — never a wallet holding mainnet funds;
* without the variable, behavior is unchanged (deterministic dev-victim).


## Judge wallet connections (WalletConnect)

Judges never touch the backend or any env file. In `apps/web` (step 1 of the
page) they connect their **own** wallet:

* desktop with MetaMask → injected provider used directly;
* any other wallet (mobile Trust, Ledger, …) → **WalletConnect QR** via
  `WALLETCONNECT_PROJECT_ID` in the API `.env` (free id from
  cloud.walletconnect.com; it is a public browser-side identifier).

The key-custody flow is unchanged: `/swap-request` returns an *unsigned* swap,
the judge signs `eth_signTransaction` inside their own wallet, and only the
raw signed tx reaches `/execute-sandwich`. Judge latency is absorbed because
signing completes in the browser before the backend waits for the next block.

> Note: the victim swap carries a 2-minute deadline — the UI prompts judges to
> sign within ~90 seconds of requesting it.

## Honest-execution guarantees

* Nothing about ordering is simulated or fabricated; every tx really exists on
  Sepolia, and the recorded order is read back from receipts (`rcpt.index`).
* Adjacency is attempted, not guaranteed — if ordering fails (reorg/spam),
  amounts are recomputed from live reserves and the trio retried, same as the
  golden implementation.
* Historical transactions serve strictly as regression fixtures
  (`data/fixtures/golden-sandwich.json`).
