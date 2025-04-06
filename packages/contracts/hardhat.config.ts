// packages/contracts/hardhat.config.ts
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import "@nomicfoundation/hardhat-ignition-ethers";
import dotenv from 'dotenv';
import "./tasks/filfoxVerify"; // Import the custom task

// Load .env file from the root of the 'contracts' package
dotenv.config();

const DEPLOYER_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY || "";
// Use FILSCAN_API_KEY or default to an empty string if not needed/provided
const FILSCAN_API_KEY = process.env.FILSCAN_API_KEY || ""; // Default to empty string

// --- Network Configuration ---
// Calibration Testnet (Recommended RPC)
const CALIBRATION_RPC_URL = process.env.CALIBRATION_RPC_URL || "https://api.calibration.node.glif.io/rpc/v1";
const CALIBRATION_NETWORK_KEY = "calibration";
const CALIBRATION_CHAIN_ID = 314159;
// Filscan API and Browser URLs for Calibration
const CALIBRATION_FILSCAN_API_URL = "https://api-calibration.filscan.io/api/v1"; // Official API endpoint
const CALIBRATION_FILSCAN_BROWSER_URL = "https://calibration.filscan.io/";

// --- Validation ---
if (!DEPLOYER_PRIVATE_KEY) {
    console.warn("WARNING: WALLET_PRIVATE_KEY not set in .env file for contracts package. Deployments and verifications will fail.");
}
// Removed FILSCAN_API_KEY warning as empty string is acceptable
// if (!FILSCAN_API_KEY) { console.warn("WARNING: FILSCAN_API_KEY not set..."); }
if (!CALIBRATION_RPC_URL) {
    console.error("ERROR: CALIBRATION_RPC_URL is missing. Cannot configure Calibration network.");
    process.exit(1); // Exit if primary network RPC is missing
}


const config: HardhatUserConfig = {
  solidity: {
    // Use the 'compilers' array to specify multiple versions
    compilers: [
      {
        version: "0.8.19", // Keep if other contracts use it or might in future
        settings: {
          // Define settings even if not currently deploying with this version
          optimizer: {
            enabled: true, // Example setting
            runs: 200      // Example setting
          },
        },
      },
      // *** ENSURE THIS ENTRY MATCHES YOUR DEPLOYMENT COMPILER AND SETTINGS for 0.8.24 ***
      {
        version: "0.8.24", // The version confirmed used for Aggregator deployment
        settings: {
          optimizer: {
            enabled: true, // Match the setting used when deploying 0x5b5...622
            runs: 200      // Match the setting used when deploying 0x5b5...622
          },
          // viaIR: false, // Match the setting used when deploying 0x5b5...622 (if non-default)
          // metadata: { bytecodeHash: "none" }, // Match the setting (if non-default)
        },
      },
    ],
  },
  networks: {
    // --- Filecoin Calibration Testnet ---
    [CALIBRATION_NETWORK_KEY]: {
      url: CALIBRATION_RPC_URL,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      chainId: CALIBRATION_CHAIN_ID,
    },
    // Local Hardhat Network
    hardhat: { chainId: 31337 },
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
  },
};

export default config;

// ==== ./kintask/packages/contracts/hardhat.config.ts ====