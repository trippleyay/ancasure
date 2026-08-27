# Controlled Demo Walkthrough

All commands run from the repository root after `npm install && cp .env.example .env`.

## One-time environment

```bash
npx tsx demo/token/deploy-token.ts     # deploys MEVTEST ERC-20, writes artifacts
npx tsx demo/pool/setup-pool.ts        # official-factory WETH/MEVTEST pair + liquidity
# pool drift between demos? canonical reset (donate deltas + sync):
npx tsx demo/pool/reset-pool.ts
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

## Honest-execution guarantees

* Nothing about ordering is simulated or fabricated; every tx really exists on
  Sepolia, and the recorded order is read back from receipts (`rcpt.index`).
* Adjacency is attempted, not guaranteed — if ordering fails (reorg/spam),
  amounts are recomputed from live reserves and the trio retried, same as the
  golden implementation.
* Historical transactions serve strictly as regression fixtures
  (`data/fixtures/golden-sandwich.json`).
