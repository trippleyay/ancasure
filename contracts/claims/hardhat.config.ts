import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import * as path from "path";

// Reach the monorepo root .env regardless of CWD.
dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || process.env.ETHEREUM_RPC_URL;
const DEPLOYER_PRIVATE_KEY = process.env.PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY ?? process.env.AUTHORIZER_PRIVATE_KEY;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hardhat: {},
    ...(SEPOLIA_RPC_URL && DEPLOYER_PRIVATE_KEY
      ? {
          sepolia: {
            url: SEPOLIA_RPC_URL,
            accounts: [DEPLOYER_PRIVATE_KEY],
          },
        }
      : {}),
  },
};

export default config;
