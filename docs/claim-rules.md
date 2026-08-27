# Claim Rules

## Definitions

* **Verified loss (raw)** — deterministic integer (wei-scale) produced by
  `packages/simulator`: counterfactual output minus actual output, reconstructed
  from Sync-reserve state immediately before the front-run and exact replays
  through official V2 math.
* **Policy cap** — per-user maximum payout registered at protection time.
* **Payout** — `min(verifiedLoss × 70 / 100, policyCap)`.

The ratio (70/100) and any global maximum cap are mirrored between
`packages/shared/src/config.ts` (`CLAIM_RATIO_NUMERATOR/DENOMINATOR`,
`DEFAULT_POLICY_CAP_RAW`) and `AncaSureClaims.sol` so off-chain quotes and
on-chain settlements can never disagree.

## Authorization flow

```
backend pipeline result (verifiedLossRaw)
        │
        ▼
authorizer EOA signs+submits
AncaSureClaims.submitVerifiedClaim(claimant, verifiedLossRaw, victimTxHash)
        │                                   (onlyAuthorizer)
        ▼
contract computes payout = min(loss*70/100, policy.cap)
claim stored state=Eligible ──► anyone may call payClaim(id) ──► state=Paid
```

**Non-negotiable invariants**

1. The contract never trusts a frontend-provided loss value. `submitVerifiedClaim`
   is callable only by `authorizer`; that key belongs to the backend and exists
   to translate the proof-pipeline outcome on-chain.
2. `victimTxHash` binds each claim to exactly one provable Sepolia/Mainnet
   transaction — duplicate claims for the same hash are rejected at the API layer.
3. Cap enforcement happens in-contract, not just in the API quote.
4. Payout is single-use (`Eligible → Paid`, checked-then-set before transfer).
5. Registration requires `0 < cap <= MAX_CAP`; users cannot self-grant unbounded liability.
