// packages/contracts/hardhat.config.ts
import { HardhatUserConfig } from "hardhat/config";
import "./tasks/registerKB";
import "./tasks/calculateHash";
import "./tasks/registerKB";
import "@nomicfoundation/hardhat-toolbox";
import "./tasks/registerKB";
import "./tasks/calculateHash";
import "./tasks/registerKB";
import "@nomicfoundation/hardhat-verify";
import "./tasks/registerKB";
import "./tasks/calculateHash";
import "./tasks/registerKB";
import "@nomicfoundation/hardhat-ignition-ethers";
import "./tasks/registerKB";
import "./tasks/calculateHash";
import "./tasks/registerKB";
import dotenv from 'dotenv';
import "./tasks/registerKB";
import "./tasks/calculateHash";
import "./tasks/registerKB";
import "./tasks/filfoxVerify"; // Import the custom task
import "./tasks/registerKB";
import "./tasks/calculateHash";
import "./tasks/registerKB";

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
const CALIBRATION_RPC_URL = process.env.CALIBRATION_RPC_URL || "https://api.calibration.node.glif.io/rpc/v1";
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
// Warn if other keys used in tests are missing
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
    // Use the 'compilers' array to specify multiple versions if needed
    compilers: [
      {
        version: "0.8.19", // If used by some contracts
        settings: {
          optimizer: { enabled: true, runs: 200 }, // Example settings
        },
      },
      {
        version: "0.8.24", // Version confirmed for Aggregator deployment
        settings: {
          // *** ENSURE THESE MATCH THE DEPLOYMENT ARTIFACT for 0.8.24 ***
          optimizer: {
            enabled: true, // Match deployment setting
            runs: 200      // Match deployment setting
          },
          // viaIR: false, // Match deployment setting (if non-default)
        },
      },
    ],
  },
  networks: {
    // --- Filecoin Calibration Testnet ---
    [CALIBRATION_NETWORK_KEY]: {
      url: CALIBRATION_RPC_URL,
      // *** PROVIDE ALL PRIVATE KEYS TO THE ACCOUNTS ARRAY ***
      // Hardhat uses these to populate ethers.getSigners() in order
      accounts: [
          DEPLOYER_PRIVATE_KEY, // owner = index 0
          AGENT1_PK,          // agent1Wallet = index 1
          AGENT2_PK,          // agent2Wallet = index 2
          AGENT3_PK,          // agent3Wallet = index 3
          SUBMITTER_PK        // evidenceSubmitter = index 4
      ].filter(key => key !== ""), // Filter out empty strings if keys aren't set in .env
      chainId: CALIBRATION_CHAIN_ID,
      // Recommended: Increase timeout for testnet interactions
      timeout: 120000, // 120 seconds
    },
    // Local Hardhat Network
    hardhat: {
        chainId: 31337
        // You can configure accounts for the local hardhat network too if needed
        // accounts: [{privateKey: DEPLOYER_PRIVATE_KEY, balance: "1000000000000000000000"}] // Example
    },
  },
  // --- Configure Etherscan plugin for Filscan ---
  etherscan: {
    apiKey: {
       // Provide empty string if no key is used/needed for Filscan API
       [CALIBRATION_NETWORK_KEY]: FILSCAN_API_KEY, // Will be "" if FILSCAN_API_KEY not set
    },
    customChains: [
         {
             // Configuration for Filecoin Calibration
             network: CALIBRATION_NETWORK_KEY, // Must match the key in networks and apiKey
             chainId: CALIBRATION_CHAIN_ID,
             urls: {
               // Use Filscan's API endpoint for verification
               apiURL: CALIBRATION_FILSCAN_API_URL,
               // Use Filscan's browser URL for linking
               browserURL: CALIBRATION_FILSCAN_BROWSER_URL
             }
        },
        // Add other custom chains here if needed (e.g., mainnet, Base Sepolia)
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
    target: "ethers-v6", // Keep target as ethers-v6 if using ethers v6 elsewhere
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
    // Optional: configure gas reporter further if needed
    // coinmarketcap: process.env.COINMARKETCAP_API_KEY,
    // gasPriceApi: "https://api.calibration.node.glif.io/rpc/v1", // Use relevant RPC for gas price
    // token: "FIL", // Or tFIL for testnet? Check reporter docs
  },
};

export default config;

// ==== ./kintask/packages/contracts/hardhat.config.ts ====