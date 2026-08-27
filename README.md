# AncaSure

**Decentralized insurance protocol for DEX traders** — compensates victims of sandwich attacks.

AncaSure does **not** prevent MEV. It makes attackers' damage financial rather than fatal:

1. A user registers a wallet for coverage.
2. The user trades normally on a supported DEX.
3. A sandwich attack occurs on an external EVM chain.
4. [Creditcoin](https://creditcoin.org)'s Attestcoin infrastructure cryptographically verifies the attacker's front-run, the victim transaction, and the back-run against the source chain's state commitments.
5. The protocol reconstructs what the victim **would have received without the front-run**.
6. The difference is the *verified attack-attributable loss*.
7. The user may claim **70% of that verified loss**, subject to the policy cap: `payout = min(70% × verifiedLoss, policyCap)`.
8. Claim authorization and payout settle through Creditcoin.

## Repository layout

| Path | Contents |
|---|---|
| `packages/shared` | Cross-package types + product config (claim ratio, caps, chain registry) |
| `packages/detector` | **Proven** run-based Uniswap V2 sandwich detector (multi-victim/multi-pool) |
| `packages/simulator` | **Proven** deterministic counterfactual-loss simulator |
| `packages/ethereum` | Ethereum RPC utilities, log decoding, normalization, Sepolia demo helpers |
| `packages/creditcoin` | Creditcoin/Attestcoin integration (ProofBuilder → BlockProver → normalized evidence) |
| `apps/api` | Backend HTTP API (`POST /detect`, `POST /simulate`, claim authorization service) |
| `apps/web` | Minimal judge-facing frontend (connect → register → protected swap → claim) |
| `contracts/claims` | `AncaSureClaims.sol` + Hardhat tests/deploy |
| `demo/` | Controlled Sepolia environment: MEVTEST token, pool setup/reset, controlled sandwich |
| `docs/` | `architecture.md`, `claim-rules.md`, `demo.md` |

## Quick start

```bash
cp .env.example .env      # fill in an Alchemy key + a throwaway Sepolia private key
npm install
npm test                  # detector + simulator regression suites
npm run dev:api           # API on :3000
```

Full controlled-demo walkthrough (token → pool → sandwich → detection → claim): see [`docs/demo.md`](docs/demo.md).

## Security posture

* Private keys are read from env only and are never logged, persisted, or committed.
* Verified-loss values enter the system exclusively via the backend proof pipeline
  (Creditcoin-verified). The claims contract accepts them only from its
  `authorizer` role — frontends cannot influence payouts.
* Regression fixtures reference real, reproducible Sepolia transactions (see
  `data/fixtures/golden-sandwich.json`) but nothing in the live demo depends on
  historical data.

## Status

MVP foundation: proven detection/simulation cores ported verbatim; Creditcoin
verification wired end-to-end; controlled Sepolia sandwich service; minimal
claims contract with 70%/cap economics; basic web UI.
