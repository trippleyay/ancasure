# AncaSure

AncaSure is an insurance product for DEX traders that covers qualifying losses caused by verified sandwich attacks.

## The problem

Sandwich attacks can worsen a trader's execution. A front-run trade moves the pool price before the victim's swap, and a back-run reverses it afterward. The victim receives less output than they would have in a normal trade.

Existing approaches often focus on avoiding or preventing the attack. AncaSure takes a different approach: it provides coverage after a qualifying loss occurs.

## What AncaSure does

1. Add wallets to coverage.
2. Pay for a 30-day coverage period.
3. Trade normally.
4. If a qualifying sandwich attack occurs, submit the affected transaction.
5. AncaSure verifies the evidence and measures the loss.
6. An eligible claim can receive 70% of the verified loss, subject to the policy cap.

## Why the project is different

- Insurance rather than attack prevention.
- No change to how the user trades.
- Claim based on measurable loss.
- Independently verifiable claim evidence.
- The claim does not depend on a private operator simply declaring that an attack occurred.

## How Creditcoin and Attestcoin are used

**Attestcoin / Creditcoin**
- Verifies external-chain transaction evidence used to assess the claim.
- Verifies the relevant transactions and receipt/log evidence.
- Provides the trusted evidence needed by the claim process.

**AncaSure**
- Manages wallet coverage.
- Stores policy state.
- Applies eligibility rules.
- Calculates the insurance benefit.
- Handles claim authorization and payout through its own claims contract.


## How the loss is measured

1. Identify the front-run, the user's transaction, and the back-run.
2. Reconstruct what the trade would have returned without the front-run.
3. Compare that with the actual result.
4. Calculate the verified loss.
5. Apply the 70% coverage rule and policy cap.

The simulator reconstructs pre-front-run reserves from the pair's Sync log and replays the exact observed swap amounts through Uniswap V2 math. The difference between the counterfactual output and the simulated output with the attack is the verified loss.

## Proof that it works

### Real Ethereum sandwich example

The repository includes a golden regression fixture from a fully successful controlled Sepolia sandwich:

- **Block:** 11577375
- **Transaction ordering:** front-run (index 0), victim (index 1), back-run (index 2)
- **Victim transaction:** `0x89c9625358b4f62426ff4b3b98968c377c5b2ee81c85e1562f9e2d58862118a0`
- **Classification:** SANDWICH
- **Simulation result:** exactMatch = true

### Controlled Sepolia sandwich

The demo runs a repeatable sandwich attack on Sepolia using a MEVTEST token paired with WETH:

- **MEVTEST token:** `0x0BFEEaeA054068F6befcF03d9C09D416788c49D1`
- **WETH/MEVTEST pair:** `0x0fC13e7D6111f5128579A83028d98505913192c5`
- The attacker front-runs, the victim swaps, and the attacker back-runs in the same block.
- The pipeline detects the sandwich, simulates the loss, verifies the evidence on Creditcoin, and quotes a payout on-chain.

### Creditcoin proof verification

Every claim passes through the Creditcoin proof pipeline:

1. `ProofBuilder.getProof(txHash)` generates Merkle inclusion and continuity proofs.
2. `PrecompileBlockProver.verifySingle()` verifies the proof against the Creditcoin precompile.
3. The verified evidence is decoded into normalized transaction/receipt fields.

### Multi-victim and multi-pool handling

The detector handles multiple victims in a single sandwich run and multiple pools when the attacker mirrors trades across pools that the victims actually touched. The tests confirm:

- Single-victim sandwiches
- Multi-victim sandwiches (multiple executed victim txs in one run)
- Multi-pool sandwiches where each victim is attributed only to the pool they swapped on
- Guards that reject false positives: unrelated neighbors, different senders, different pools, failed victim txs, partial mirrors, proximity-only patterns, and gap scenarios

## Demo

Connect wallet, get covered, submit or generate an affected trade, verify the claim, and claim the covered amount.

### AncaSure web app

The main product UI (`apps/web`) has three screens:

- **Dashboard** - add and remove wallets, view coverage status and claims history.
- **Protect wallets** - select wallets and pay the premium on-chain via `registerProtectionFor`.
- **File a claim** - paste a victim transaction hash and run the eligibility check.

### MEV Creator (separate component)

The repository also contains a standalone attack simulator called **MEV Creator** (`apps/mev-demo`). It is served at `GET /mev-demo` while the API runs. Anyone can connect a wallet (which becomes the victim) and fire a real front-run/victim/back-run trio on Sepolia. This is a technical demo for creating attacks, separate from the AncaSure product UI.

## Supported scope and limitations

### Supported source chains

- Ethereum Mainnet
- Ethereum Sepolia

### AMM scope

- Uniswap V2-style pairs (Sync/Swap topic-based detection and simulation)

### Known limitations

- This is a testnet MVP. The claims contract is deployed on Sepolia.
- Coverage is denominated in ETH with a fixed premium per wallet per 30-day period. There is no USD oracle.
- The default policy cap is 0.05 ETH per claim.
- Multi-leg victim swaps (multi-hop) are detected but total loss aggregation across legs is marked as null in the simulation report when there is more than one leg.
- The MEV Creator attack is designed for demo repeatability. Real-world sandwich attacks do not guarantee adjacency.

## Repository structure

```
AncaSure/
├── apps/
│   ├── api/          # Backend API (detection, simulation, verification, claims)
│   ├── web/          # React + wagmi web app (Dashboard, Protect, Claim)
│   └── mev-demo/     # Standalone MEV Creator (attack simulator)
├── contracts/
│   └── claims/       # AncaSureClaims.sol and Hardhat project
├── packages/
│   ├── shared/       # Config, types, constants (70% ratio, caps, source chains)
│   ├── ethereum/     # RPC client, decoder, Uniswap V2 service
│   ├── detector/     # Sandwich detection pipeline
│   ├── simulator/    # Counterfactual loss calculation
│   └── creditcoin/   # ProofBuilder, BlockProver, evidence normalization
├── data/
│   ├── fixtures/     # Golden sandwich regression fixture
│   └── demo/         # Demo artifacts, deployment info, run logs
├── demo/             # Controlled sandwich demo scripts
├── docs/             # Architecture, claim rules, demo walkthrough
└── scripts/          # Artifact seeding
```

## Testing

The test suite covers detection, simulation, and the claims contract.

### Run all tests

```bash
npm test
```

### Run specific test suites

```bash
npm run test:detector    # Sandwich detector tests (17 cases)
npm run test:simulator   # V2 math and sandwich simulation tests
npm run test:creditcoin  # Creditcoin proof pipeline tests
npm run test:contracts   # AncaSureClaims.sol unit tests (8 cases)
```

### What the tests prove

**Detector tests** confirm:

- Valid single-victim sandwiches are classified as SANDWICH.
- Normal swaps with unrelated neighbors are NOT_SANDWICH.
- Same pool but different front/back senders is rejected.
- Same attacker but different pools is rejected.
- Failed victim transactions are rejected.
- Multi-victim sandwiches where multiple executed txs are attributed correctly.
- Multi-pool sandwiches where the attacker mirrors both legs and victims touch both pools.
- Guards against partial mirrors, proximity-only patterns, and gap scenarios.

**Simulator tests** confirm:

- `getAmountOut` matches the official Uniswap V2 formula.
- `applySwapTo` is invertible.
- The simulator reproduces the victim's actual output exactly when the observed amounts match.
- The counterfactual loss is computed correctly.
- Mismatches are flagged when the actual output deviates from the simulation.

**Contract tests** confirm:

- Payout is exactly 70% of verified loss when below the cap.
- Payout is capped at the policy cap.
- Only the authorizer can submit verified claims.
- Uncovered wallets get a zero quote.
- Premium accounting is exact.
- Multi-wallet payment by a payer works.
- Claims pay out exactly once and are marked Paid.
- Uncovered and expired policies are refused.
- Only the owner can rotate the authorizer or ownership.

## Architecture

```
User
  → AncaSure (web app + API)
  → external-chain transaction evidence (transaction hashes, receipts, logs)
  → Attestcoin / Creditcoin verification (ProofBuilder + BlockProver)
  → loss calculation (detector + simulator)
  → AncaSure claims contract (AncaSureClaims.sol)
  → claim / payout
```

### Trust boundaries

1. Detection and simulation are deterministic. They are pure functions over on-chain logs.
2. Cross-chain truth comes only from Attestcoin. The BlockProver precompile verifies Merkle inclusion and block continuity proofs generated by the USC ProofBuilder.
3. Contract-side trust is minimized. `AncaSureClaims` accepts verified losses solely from the authorizer address. The authorizer is the backend signer whose submission is derived from pipeline outputs.
4. Nothing depends on attacker cooperation. All inputs are public chain data.

## Hackathon context

AncaSure was built for BUIDL CTC 2026 Fall and uses the Attestcoin Protocol as a core part of claim verification.

## Future direction

Possible directions include:

- Broader source-chain support as Creditcoin attestation support expands.
- Broader AMM coverage.
- Stronger production controls.
- Deeper policy and underwriting design.

## License

MIT License. See [LICENSE](LICENSE) for details.

The license covers the project's code. It does not change the separate licenses or terms of third-party dependencies, protocols, trademarks, or external assets.
