/**
 * Step 1 — compile & deploy MevTestToken (ERC-20 "MEV Test") on Sepolia.
 *   npx tsx scripts/sandwich-demo/deploy-token.ts
 */
import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const solc = require("solc");
import {
  getProvider,
  getMasterWallet,
  saveArtifacts,
  MINT_MEVTEST,
} from "../lib";

export function compileToken(): { abi: unknown[]; bytecode: string } {
  const src = fs.readFileSync(
    path.resolve(__dirname, "MevTestToken.sol"),
    "utf8",
  );
  const input = {
    language: "Solidity",
    sources: { "MevTestToken.sol": { content: src } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (out.errors ?? []).filter((e: { severity: string }) => e.severity === "error");
  if (errors.length) throw new Error(errors.map((e: { formattedMessage: string }) => e.formattedMessage).join("\n"));
  const c = out.contracts["MevTestToken.sol"]["MevTestToken"];
  return { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object };
}

export async function main(): Promise<void> {
  const provider = getProvider();
  const wallet = getMasterWallet(provider);
  const { abi, bytecode } = compileToken();
  console.log(`Deployer: ${wallet.address} | balance: ${ethers.formatEther(await provider.getBalance(wallet.address))} ETH`);
  console.log("Compiling MevTestToken... ok");

  const factory = new ethers.ContractFactory(abi as never, bytecode, wallet);
  const token = await factory.deploy(MINT_MEVTEST, {
    gasLimit: 1_200_000,
    maxFeePerGas: ethers.parseUnits("30", "gwei"),
    maxPriorityFeePerGas: ethers.parseUnits("2", "gwei"),
  });
  const receipt = await token.deploymentTransaction()!.wait();
  if (!receipt || receipt.status !== 1) throw new Error("Token deployment failed");
  const tokenAddr = await token.getAddress();
  console.log(`MevTestToken deployed at ${tokenAddr} (tx ${receipt.hash}, gasUsed ${receipt.gasUsed})`);

  const erc20 = new ethers.Contract(tokenAddr, abi as never, provider);
  console.log(`name=${await erc20.name()} symbol=${await erc20.symbol()} totalSupply=${ethers.formatEther(await erc20.totalSupply())}`);

  saveArtifacts({ mevTestToken: String(tokenAddr), attacker: wallet.address });
}

if (process.argv[1] && process.argv[1].endsWith("deploy-token.ts")) {
  main().catch((e) => {
    console.error("DEPLOY FAILED:", e.message ?? e);
    process.exit(1);
  });
}
