/**
 * Deploy AncaSureClaims to Sepolia.
 *
 *   npm run deploy:sepolia      # from contracts/claims
 *
 * Authorizer = the backend EOA (AUTHORIZER_PRIVATE_KEY's address if provided,
 * otherwise the deployer itself for local MVP convenience — documented in
 * docs/claim-rules.md). MAX_CAP defaults to 0.05 ETH-equivalent raw units,
 * matching packages/shared DEFAULT_POLICY_CAP_RAW.
 *
 * Writes the deployed address to ../../data/demo/claims-deployment.json.
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..", "..", "..");

async function main(): Promise<void> {
  const maxCapRaw =
    process.env.MAX_POLICY_CAP_RAW ?? ethers.parseEther("0.05").toString();

  let authorizer = process.env.AUTHORIZER_ADDRESS;
  if (!authorizer) {
    const [deployer] = await ethers.getSigners();
    authorizer = await deployer.getAddress();
    console.log(`AUTHORIZER_ADDRESS not set — using deployer ${authorizer}`);
  }

  console.log(`Network: ${network.name} | MAX_CAP(raw): ${maxCapRaw}`);

  const factory = await ethers.getContractFactory("AncaSureClaims");
  const claims = await factory.deploy(authorizer, maxCapRaw);
  await claims.waitForDeployment();

  const address = await claims.getAddress();
  console.log(`AncaSureClaims deployed at: ${address}`);

  const outDir = path.join(ROOT, "data", "demo");
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, "claims-deployment.json");
  fs.writeFileSync(
    file,
    JSON.stringify(
      { network: network.name, address, authorizer, maxCapRaw, deployedAt: new Date().toISOString() },
      null,
      2,
    ),
  );
  console.log(`Saved → ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
