/**
 * Deploy AncaSureClaims to Sepolia.
 *
 * Env:
 *   SEPOLIA_RPC_URL           Sepolia endpoint
 *   DEPLOYER_PRIVATE_KEY      deployer / owner wallet key
 *   AUTHORIZER_PRIVATE_KEY    backend authorizer EOA key (may equal deployer)
 *
 * Writes data/demo/claims-deployment.json { address, authorizer }.
 */
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const rpc = process.env.SEPOLIA_RPC_URL;
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY ?? process.env.AUTHORIZER_PRIVATE_KEY;
  const authorizerKey = process.env.AUTHORIZER_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY;
  if (!rpc) throw new Error("SEPOLIA_RPC_URL is not set");
  if (!deployerKey) throw new Error("DEPLOYER_PRIVATE_KEY or AUTHORIZER_PRIVATE_KEY is required");
  if (!authorizerKey) throw new Error("AUTHORIZER_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY is required");

  const provider = new ethers.JsonRpcProvider(rpc);
  const deployer = new ethers.Wallet(deployerKey.startsWith("0x") ? deployerKey : "0x" + deployerKey, provider);
  const authorizer = new ethers.Wallet(
    authorizerKey.startsWith("0x") ? authorizerKey : "0x" + authorizerKey,
    provider,
  );

  console.log(`Deployer: ${deployer.address}`);
  console.log(`Authorizer: ${authorizer.address}`);

  // Import compiled artifact produced by `npx hardhat compile`.
  const artifact = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "artifacts", "contracts", "AncaSureClaims.sol", "AncaSureClaims.json"), "utf8"),
  );

  // Global cap bound: default per-policy cap ceiling (0.05 ETH in wei).
  const maxCapRaw = ethers.parseEther("0.05");

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const claims = await factory.deploy(authorizer.address, maxCapRaw);
  await claims.waitForDeployment();
  const address = await claims.getAddress();

  console.log(`AncaSureClaims deployed: ${address}`);
  console.log(`maxCapRaw: ${maxCapRaw.toString()}`);

  const outPath = path.resolve(__dirname, "..", "..", "..", "data", "demo", "claims-deployment.json");
  fs.writeFileSync(outPath, JSON.stringify({ address, authorizer: authorizer.address }, null, 2));
  console.log(`Wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
