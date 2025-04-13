// packages/contracts/hardhat.config.ts
import { HardhatUserConfig } from "hardhat/config";
import "./tasks/registerKB";
import "./tasks/calculateHash";
import "./tasks/filfoxVerify"; // Import the custom task
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import "@nomicfoundation/hardhat-ignition-ethers";
import dotenv from 'dotenv';

// Load .env file from the root of the 'contracts' package
dotenv.config();

// Read ALL necessary private keys from environment variables
const DEPLOYER_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY || ""; // Owner/Deployer
const AGENT1_PK = process.env.AGENT1_PK || "";
const AGENT2_PK = process.env.AGENT2_PK || "";
const AGENT3_PK = process.env.AGENT3_PK || "";
const SUBMITTER_PK = process.env.SUBMITTER_PK || "";

// API Keys and RPC URLs
const FILSCAN_API_KEY = process.env.FILSCAN_API_KEY || ""; // Default to empty string
const CALIBRATION_RPC_URL =  "https://api.calibration.node.glif.io/rpc/v1";
const CALIBRATION_NETWORK_KEY = "calibration";
const CALIBRATION_CHAIN_ID = 314159;
const CALIBRATION_FILSCAN_API_URL = "https://api-calibration.filscan.io/api/v1";
const CALIBRATION_FILSCAN_BROWSER_URL = "https://calibration.filscan.io/";

// --- Validation ---
// Validate the DEPLOYER key specifically as it's crucial
if (!DEPLOYER_PRIVATE_KEY) {
    console.error("ERROR: WALLET_PRIVATE_KEY (for deployer/owner) is not set in .env. Tests require this.");
    // Consider exiting if the primary key is essential for all operations
    // process.exit(1);
}
if (!AGENT1_PK) console.warn("WARNING: AGENT1_PK not set in .env. Tests using agent1Wallet might fail.");
if (!AGENT2_PK) console.warn("WARNING: AGENT2_PK not set in .env. Tests using agent2Wallet might fail.");
if (!AGENT3_PK) console.warn("WARNING: AGENT3_PK not set in .env. Tests using agent3Wallet might fail.");
if (!SUBMITTER_PK) console.warn("WARNING: SUBMITTER_PK not set in .env. Tests using evidenceSubmitter might fail.");
if (!CALIBRATION_RPC_URL) {
    console.error("ERROR: CALIBRATION_RPC_URL is missing. Cannot configure Calibration network.");
    process.exit(1); // Exit if primary network RPC is missing
}

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.19", // If used by some contracts
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: true,
        },
      },
      {
        version: "0.8.28", // If used by some contracts
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: true,
        },
      },
      {
        version: "0.8.24", // Version confirmed for Aggregator deployment
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: true,        // <<< THIS ENABLES THE FIX
        },
      },
    ],
  },
  networks: {
    [CALIBRATION_NETWORK_KEY]: {
      url: CALIBRATION_RPC_URL,
      accounts: [
          DEPLOYER_PRIVATE_KEY, // owner = index 0
          AGENT1_PK,          // agent1Wallet = index 1
          AGENT2_PK,          // agent2Wallet = index 2
          AGENT3_PK,          // agent3Wallet = index 3
          SUBMITTER_PK        // evidenceSubmitter = index 4
      ].filter(key => key !== ""),
      chainId: CALIBRATION_CHAIN_ID,
      timeout: 300000, // Increased to 5 minutes (from 120 seconds)
      gasPrice: 50000000000, // 50 Gwei - Higher for Calibration network
      gas: 8000000, // Higher gas limit for contract deployments
      // confirmations: 2, // Wait for 2 confirmations
      // networkCheckTimeout: 100000,
      // Remove the httpHeaders configuration that's causing the error
    },
    hardhat: {
        chainId: 31337
    },
  },
  etherscan: {
    apiKey: {
       [CALIBRATION_NETWORK_KEY]: FILSCAN_API_KEY
    },
    customChains: [
         {
             network: CALIBRATION_NETWORK_KEY,
             chainId: CALIBRATION_CHAIN_ID,
             urls: {
               apiURL: CALIBRATION_FILSCAN_API_URL,
               browserURL: CALIBRATION_FILSCAN_BROWSER_URL
             }
         },
    ]
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  typechain: {
    outDir: "./typechain-types",
    target: "ethers-v6",
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
  mocha: {
    timeout: 300000 // 5 minutes for tests
  }
};

export default config;