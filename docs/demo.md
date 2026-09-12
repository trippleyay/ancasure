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

## Two apps, one codebase

- **AncaSure** (`apps/web`, served by `npm run dev:web`) — the product: connect
  wallet, manage/protect wallets, file claims. Never asks for private keys; the
  connected wallet signs everything (WalletConnect or injected).
- **MEV Creator** (`apps/mev-demo`, served at **`GET http://localhost:3000/mev-demo`**
  while the API runs) — a standalone attack simulator for anyone, AncaSure or
  not. Connect any wallet (it becomes the victim — it signs its own swap via
  `eth_signTransaction` in-browser, no keys typed) and fire a real
  front-run/victim/back-run trio on Sepolia.

## End-to-end flow

The React app (`npm run dev:web`) has three screens: **Dashboard** (add/remove
wallets), **Protect wallets** (pay premium on-chain via `registerProtectionFor`),
and **File a claim** (paste a victim tx hash → `POST /check-eligibility`).

1. Judge opens the web app, connects a wallet (this connected wallet is the
   owner; it appears automatically on the Dashboard).
2. *Register protection* — on **Protect wallets** the owner selects wallets and
   pays `PREMIUM_PER_WALLET` per wallet in one transaction
   (`registerProtectionFor([...])` on the deployed `AncaSureClaims`). Coverage
   state lives ONLY on-chain; the Dashboard reads it live via
   `GET /wallets?owner=0x..` (SQLite stores just the owner→wallet list).
3. *Attack* — the MEV creator (`demo/sandwich/service.ts`) builds the controlled
   trio around a victim swap:
   - **Browser flow (judge wallet = victim):** `POST /swap-request` returns an
     unsigned victim swap (router path WETH→MEVTEST, minOut=1); the judge signs
     it in-browser and the signed tx is POSTed to `POST /execute-sandwich`.
   - **CLI flow (any wallet as victim):** `VICTIM_PRIVATE_KEY=0x<key>
     npx tsx demo/sandwich/run-sandwich.ts`.
   The backend pre-signs front-run (12.02 gwei tip) and back-run (12.00 gwei),
   waits for a fresh block and broadcasts all three nearly simultaneously —
   builders pack them by descending priority fee: **[front][victim][back]**
   (identical mechanics to the validated golden run).
4. On confirmation all three hashes + block/index are recorded
   (`data/demo/run-latest.json`, also `GET /run-latest`) and echoed back.
5. *Claim* — paste the victim tx hash on **File a claim**. Pipeline:
   `POST /detect` classifies the run → `POST /simulate` computes the verified
   counterfactual loss → `POST /verify` builds Attestcoin/Creditcoin proofs for
   all three transactions → eligibility is quoted on-chain. The claimant is
   always the **victim tx signer**; `AncaSureClaims` checks its active paid
   policy, enforces `payout = min(70% × verifiedLoss, cap)` and duplicate-claim
   protection, and pays out. Uncovered wallets and non-sandwich transactions are
   rejected there — never by Creditcoin, which only verifies evidence.

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

## AncaSure app vs MEV demo

The repo hosts TWO products that will live on separate domains:

1. **AncaSure app** (`index.html` → `ancasure-*.html`): the polished
   four-screen insurance product — Landing, Dashboard, Protect wallets, File a
   claim. Premium: 0.001 ETH per wallet per 30 days (fixed on-chain), policy
   cap 0.05 ETH, payout = min(70% × verifiedLoss, cap).
2. **MEV demo** (`demo.html`, old `index.html`): functional technical demo
   (swap request → WalletConnect sign → controlled sandwich). Not part of the
   polished app.

Claims contract v2 (`AncaSureClaims`, deployed Sepolia
`0xE3C87A15aa5907E13f8C3b693Ac8d13CA01F41C2`, payout pool pre-funded):
`registerProtectionFor(address[] wallets) payable` (payer may protect other
wallets), 30-day expiry enforced in `submitVerifiedClaim`, `isCovered` /
`policies` views. Verified loss is ETH-denominated: token loss valued at the
pool's pre-attack price by `verifiedLossEthWei`.

## Honest-execution guarantees

* Nothing about ordering is simulated or fabricated; every tx really exists on
  Sepolia, and the recorded order is read back from receipts (`rcpt.index`).
* Adjacency is attempted, not guaranteed — if ordering fails (reorg/spam),
  amounts are recomputed from live reserves and the trio retried, same as the
  golden implementation.
* Historical transactions serve strictly as regression fixtures
  (`data/fixtures/golden-sandwich.json`).

## Worked example: two covered wallets, one uncovered

Goal: owner with three extra wallets — **c1** and **c2** covered, **u1** left
uncovered — then attack c1 (claim pays), attack u1 (claim rejected: uncovered),
and attempt a claim for c2 with no attack (rejected: not a sandwich).

The web app does not label wallets — note each address as you add it. The
claimant is always the **victim tx signer**, so c1 and u1 must be real wallets
you can connect with (import them into MetaMask, or scan with a mobile wallet
via WalletConnect in the MEV Creator).

```bash
# 0) one-time + servers
cp .env.example .env                  # fill RPC key, PRIVATE_KEY, CLAIMS_CONTRACT_ADDRESS
npx tsx scripts/seed-artifacts.ts
npx tsx demo/pool/reset-pool.ts       # canonicalize pool if drifted
npm run dev:api                       # terminal 1
npm run dev:web                       # terminal 2

# 1) fund c1 and u1 with trade size + gas (they must sign victim swaps)
npx tsx demo/pool/topup.ts <c1_address> 0.05
npx tsx demo/pool/topup.ts <u1_address> 0.05
```

```text
2) In the browser (connected as owner):
   Dashboard  → add c1, c2, u1 (three “+ Add wallet” — they persist in SQLite)
   Protect    → tick ONLY c1 and c2 → “Protect selected wallets” → confirm tx
                (premium = 2 × PREMIUM_PER_WALLET; u1 stays “Not covered”)

3) Attack c1 — open the MEV Creator (http://localhost:3000/mev-demo) in the
   browser, connect the c1 wallet (MetaMask or WalletConnect QR — c1 signs its
   own swap, no keys typed), click “Sign swap & run attack”.
   → the victim tx hash is auto-filled and shown on Etherscan.

4) Attack u1 — in the MEV Creator, disconnect/connect the u1 wallet
   (or just use a different browser profile), connect u1, fire the attack.

5) Give c2 a normal (non-attacked) transaction: any plain Sepolia tx from c2
   (e.g. a 0 ETH self-transfer) and note its hash — this is the “no MEV” case.
```

```text
6) In the browser, File a claim:
   • paste c1's VICTIM_HASH → eligible ✓  pipeline detects the sandwich,
     verifies evidence on Creditcoin, quotes payout on-chain, authorizer pays
     min(70% × verifiedLoss, cap)
   • paste u1's VICTIM_HASH → rejected: “wallet has no active protection” —
     evidence verifies fine, but AncaSureClaims finds no paid policy for u1
   • paste c2's plain-tx hash → rejected: “not a sandwich” — the detector
     classifies the tx as non-attack, so no loss is ever computed
```
