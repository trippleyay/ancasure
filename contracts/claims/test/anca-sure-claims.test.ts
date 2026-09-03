import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * AncaSureClaims v2 unit tests.
 *
 * Claim rule under test:  payout = min(70% of verifiedLoss, policyCap)
 * Protection rule: PREMIUM_PER_WALLET per wallet per 30-day coverage, payer may
 * differ from protected wallet. Security invariant: only authorizer records losses.
 */
describe("AncaSureClaims", function () {
  const MAX_CAP = ethers.parseEther("0.05");
  const PREMIUM = ethers.parseEther("0.001");
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
    await claims.connect(judge).registerProtectionFor([await judge.getAddress()], { value: PREMIUM });
    const loss = ethers.parseEther("0.01"); // 70% = 0.007 < cap
    await claims.connect(authorizer).submitVerifiedClaim(
      await judge.getAddress(), loss, ethers.id("0x" + "ab".repeat(32)),
    );
    const [, , payout] = await claims.claims(1);
    expect(payout).to.equal((loss * 70n) / 100n);
  });

  it("caps the payout at the policy cap (default = maxCapRaw)", async () => {
    const { claims, authorizer, judge } = await deploy();
    await claims.connect(judge).registerProtectionFor([await judge.getAddress()], { value: PREMIUM });
    const loss = ethers.parseEther("1"); // 70% far above cap
    await claims.connect(authorizer).submitVerifiedClaim(
      await judge.getAddress(), loss, ethers.id("victim"),
    );
    const [, , payout] = await claims.claims(1);
    expect(payout).to.equal(MAX_CAP);
  });

  it("rejects claim submission from anyone but the authorizer", async () => {
    const { claims, judge, attacker } = await deploy();
    await claims.connect(judge).registerProtectionFor([await judge.getAddress()], { value: PREMIUM });
    await expect(
      claims.connect(attacker).submitVerifiedClaim(
        await judge.getAddress(), ethers.parseEther("0.01"), ethers.id("v"),
      ),
    ).to.be.revertedWithCustomError(claims, "NotAuthorizer");
  });

  it("ignores frontend-declared values entirely: uncovered wallets get zero quote", async () => {
    const { claims, judge } = await deploy();
    await expect(claims.quotePayout(await judge.getAddress(), 123n)).to.not.be.reverted;
    const q = await claims.quotePayout(await judge.getAddress(), 123n);
    expect(q).to.equal(0n); // no policy → no quote
  });

  it("enforces exact premium accounting and supports multi-wallet payment by a payer", async () => {
    const { claims, judge, attacker, anyone } = await deploy();
    await expect(
      claims.connect(judge).registerProtectionFor([await judge.getAddress()], { value: PREMIUM - 1n }),
    ).to.be.revertedWithCustomError(claims, "WrongState");
    await expect(claims.connect(judge).registerProtectionFor([], { value: 0n }))
      .to.be.revertedWithCustomError(claims, "CapTooSmall");
    const w2 = await anyone.getAddress();
    await claims.connect(attacker).registerProtectionFor([await judge.getAddress(), w2], { value: PREMIUM * 2n });
    const p1 = await claims.policies(await judge.getAddress());
    const p2 = await claims.policies(w2);
    expect(p1.payer).to.equal(await attacker.getAddress());
    expect(p2.payer).to.equal(await attacker.getAddress());
    expect(p1.capRaw).to.equal(MAX_CAP);
    expect(await claims.isCovered(await judge.getAddress())).to.equal(true);
    expect(await claims.isCovered(w2)).to.equal(true);
  });

  it("pays out exactly once and marks the claim Paid", async () => {
    const { claims, authorizer, judge, anyone } = await deploy();
    await claims.connect(judge).registerProtectionFor([await judge.getAddress()], { value: PREMIUM });
    const loss = ethers.parseEther("0.04");
    await claims.connect(authorizer).submitVerifiedClaim(
      await judge.getAddress(), loss, ethers.id("v"),
    );
    const before = await ethers.provider.getBalance(await judge.getAddress());
    const expectedPayout = (loss * 70n) / 100n;

    await expect(claims.connect(anyone).payClaim(1))
      .to.emit(claims, "ClaimPaid")
      .withArgs(1n, await judge.getAddress(), expectedPayout);

    const after = await ethers.provider.getBalance(await judge.getAddress());
    expect(after - before).to.equal(expectedPayout);

    await expect(claims.connect(anyone).payClaim(1))
      .to.be.revertedWithCustomError(claims, "WrongState");
  });

  it("refuses uncovered and expired policies, and allows revocation", async () => {
    const { claims, authorizer, judge } = await deploy();
    await expect(
      claims.connect(authorizer).submitVerifiedClaim(await judge.getAddress(), 1n, ethers.id("x")),
    ).to.be.revertedWithCustomError(claims, "PolicyInactive");

    await claims.connect(judge).registerProtectionFor([await judge.getAddress()], { value: PREMIUM });
    await ethers.provider.send("evm_increaseTime", [31 * 24 * 3600]);
    await ethers.provider.send("evm_mine", []);
    await expect(
      claims.connect(authorizer).submitVerifiedClaim(await judge.getAddress(), 1n, ethers.id("x")),
    ).to.be.revertedWithCustomError(claims, "PolicyInactive");
    expect(await claims.isCovered(await judge.getAddress())).to.equal(false);

    await claims.connect(judge).registerProtectionFor([await judge.getAddress()], { value: PREMIUM });
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
