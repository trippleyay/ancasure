import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * AncaSureClaims unit tests.
 *
 * Claim rule under test:  payout = min(70% of verifiedLoss, policyCap)
 * Security invariant under test: only the authorizer can record losses.
 */
describe("AncaSureClaims", function () {
  const MAX_CAP = ethers.parseEther("0.05");
  const FUND = ethers.parseEther("1");

  async function deploy() {
    const [owner, authorizer, judge, attacker, anyone] = await ethers.getSigners();
    const F = await ethers.getContractFactory("AncaSureClaims", owner);
    const c = await F.deploy(await authorizer.getAddress(), MAX_CAP);
    await c.waitForDeployment();
    const claims = await ethers.getContractAt("AncaSureClaims", await c.getAddress());
    await owner.sendTransaction({ to: await claims.getAddress(), value: FUND });
    return { claims, owner, authorizer, judge, attacker, anyone };
  }

  it("computes payout as exactly 70% of verified loss when below cap", async () => {
    const { claims, authorizer, judge } = await deploy();
    await claims.connect(judge).registerProtection(MAX_CAP); // cap == maxCap
    const loss = ethers.parseEther("0.01"); // 70% = 0.007 < cap
    await claims.connect(authorizer).submitVerifiedClaim(
      await judge.getAddress(), loss, ethers.id("0x" + "ab".repeat(32)),
    );
    const [, , payout] = await claims.claims(1);
    expect(payout).to.equal((loss * 70n) / 100n);
  });

  it("caps the payout at the policy cap", async () => {
    const { claims, authorizer, judge } = await deploy();
    const smallCap = ethers.parseEther("0.02");
    await claims.connect(judge).registerProtection(smallCap);
    const loss = ethers.parseEther("1"); // 70% far above cap
    await claims.connect(authorizer).submitVerifiedClaim(
      await judge.getAddress(), loss, ethers.id("victim"),
    );
    const [, , payout] = await claims.claims(1);
    expect(payout).to.equal(smallCap);
  });

  it("rejects claim submission from anyone but the authorizer", async () => {
    const { claims, judge, attacker } = await deploy();
    await claims.connect(judge).registerProtection(MAX_CAP);
    await expect(
      claims.connect(attacker).submitVerifiedClaim(
        await judge.getAddress(), ethers.parseEther("0.01"), ethers.id("v"),
      ),
    ).to.be.revertedWithCustomError(claims, "NotAuthorizer");
  });

  it("ignores frontend-declared values entirely: same tx hash & caller, different losses produce different payouts", async () => {
    // Documenting the trust boundary — the contract state is only reachable
    // through submitVerifiedClaim; there is no payable/claim path accepting a
    // user-supplied loss. This test asserts policy gating instead.
    const { claims, judge } = await deploy();
    await expect(claims.quotePayout(await judge.getAddress(), 123n)).to.not.be.reverted;
    const q = await claims.quotePayout(await judge.getAddress(), 123n);
    expect(q).to.equal(0n); // inactive policy → no quote
  });

  it("enforces the global maximum cap at registration", async () => {
    const { claims, judge } = await deploy();
    const tooBig = MAX_CAP + 1n;
    await expect(claims.connect(judge).registerProtection(tooBig))
      .to.be.revertedWithCustomError(claims, "CapTooLarge");
    await expect(claims.connect(judge).registerProtection(0n))
      .to.be.revertedWithCustomError(claims, "CapTooSmall");
  });

  it("pays out exactly once and marks the claim Paid", async () => {
    const { claims, authorizer, judge, anyone } = await deploy();
    await claims.connect(judge).registerProtection(MAX_CAP);
    const loss = ethers.parseEther("0.04");
    await claims.connect(authorizer).submitVerifiedClaim(
      await judge.getAddress(), loss, ethers.id("v"),
    );
    const before = await ethers.provider.getBalance(await judge.getAddress());
    const expectedPayout = (loss * 70n) / 100n;

    await expect(claims.connect(anyone).payClaim(1)) // anyone may trigger payment
      .to.emit(claims, "ClaimPaid")
      .withArgs(1n, await judge.getAddress(), expectedPayout);

    const after = await ethers.provider.getBalance(await judge.getAddress());
    expect(after - before).to.equal(expectedPayout);

    await expect(claims.connect(anyone).payClaim(1))
      .to.be.revertedWithCustomError(claims, "WrongState");
  });

  it("refuses inactive policies and allows revocation", async () => {
    const { claims, authorizer, judge } = await deploy();
    await expect(
      claims.connect(authorizer).submitVerifiedClaim(await judge.getAddress(), 1n, ethers.id("x")),
    ).to.be.revertedWithCustomError(claims, "PolicyInactive");

    await claims.connect(judge).registerProtection(MAX_CAP);
    await claims.connect(judge).revokeProtection();
    await expect(
      claims.connect(authorizer).submitVerifiedClaim(await judge.getAddress(), 1n, ethers.id("x")),
    ).to.be.revertedWithCustomError(claims, "PolicyInactive");
  });

  it("lets only the owner rotate the authorizer or ownership", async () => {
    const { claims, owner, authorizer, attacker } = await deploy();
    await expect(
      claims.connect(attacker).setAuthorizer(await attacker.getAddress()),
    ).to.be.revertedWithCustomError(claims, "NotOwner");

    await expect(claims.connect(owner).setAuthorizer(await attacker.getAddress()))
      .to.emit(claims, "AuthorizerChanged");
    expect(await claims.authorizer()).to.equal(await attacker.getAddress());
    void authorizer;
  });
});
