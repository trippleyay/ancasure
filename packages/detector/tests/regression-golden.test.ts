import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Regression fixture for the FIRST fully successful controlled Sepolia
 * sandwich (real user-controlled deterministic victim). Per product spec these
 * hashes are regression fixtures only — never executed as the live demo.
 *
 * When RUN_GOLDEN=1 and an RPC is configured, this test additionally re-runs
 * the live detector over the real Sepolia chain data and asserts the sandwich
 * still classifies as SANDWICH (guards against rule regressions).
 */
const FIXTURE = JSON.parse(
  readFileSync(path.resolve(__dirname, "..", "..", "..", "data", "fixtures", "golden-sandwich.json"), "utf8"),
);

describe("golden sepolia sandwich fixture", () => {
  it("contains the validated front/victim/back trio on the WETH/MEVTEST pair", () => {
    expect(FIXTURE.transactions.frontRun).toMatch(/^0x[0-9a-f]{64}$/);
    expect(FIXTURE.transactions.victim).toMatch(/^0x[0-9a-f]{64}$/);
    expect(FIXTURE.transactions.backRun).toMatch(/^0x[0-9a-f]{64}$/);
    expect(FIXTURE.pair.toLowerCase()).to.equal("0x0fc13e7d6111f5128579a83028d98505913192c5");
    expect(FIXTURE.expectedResults.classification).to.equal("SANDWICH");
    expect(FIXTURE.expectedResults.simulation.exactMatch).to.equal(true);
  });

  it("re-detects the sandwich from live Sepolia data when RUN_GOLDEN=1", async () => {
    if (process.env.RUN_GOLDEN !== "1") return; // skipped by default (offline unit runs)
    const { detectForTxHash } = await import("@ancsure/detector");
    const { rpcUrlFor } = await import("@ancsure/shared");
    const result = await detectForTxHash(rpcUrlFor("ethereum-sepolia"), FIXTURE.transactions.victim);
    expect(result.classification).to.equal("SANDWICH");
    expect(result.frontRunTx?.toLowerCase()).to.equal(FIXTURE.transactions.frontRun);
    expect(result.backRunTx?.toLowerCase()).to.equal(FIXTURE.transactions.backRun);
  });
});
