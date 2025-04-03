// kintask/packages/contracts/hardhat.config.ts
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import "@nomicfoundation/hardhat-ignition-ethers";
import dotenv from 'dotenv';

dotenv.config(); // Load .env from contracts package root

const DEPLOYER_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY || "";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

// --- ACTION REQUIRED: Verify this RPC URL points to Filecoin Calibration ---
const CALIBRATION_RPC_URL = "https://api.calibration.node.glif.io/rpc/v1";
// Ensure the URL in your .env or the default here is correct for Calibration (Chain ID 314159)
// --- End Action Required ---

const CALIBRATION_NETWORK_KEY = "calibration";
const CALIBRATION_CHAIN_ID = 314159;
const CALIBRATION_EXPLORER_API_URL = "https://api-calibration.filscan.io/api/v1"; // Check Filscan docs if needed
const CALIBRATION_EXPLORER_BROWSER_URL = "https://calibration.filscan.io/";

// --- Optional: Keep other network configs if needed ---
// const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
// const BASE_SEPOLIA_NETWORK_KEY = "baseSepolia";
// const BASE_SEPOLIA_CHAIN_ID = 84532;
// const BASE_SEPOLIA_EXPLORER_API_URL = "https://api-sepolia.basescan.org/api";
// const BASE_SEPOLIA_EXPLORER_BROWSER_URL = "https://sepolia.basescan.org";
// --- End Optional Config ---


if (!DEPLOYER_PRIVATE_KEY) { /* ... warning ... */ }
if (!CALIBRATION_RPC_URL) { /* ... warning ... */ }


const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // --- Filecoin Calibration Testnet ---
    [CALIBRATION_NETWORK_KEY]: {
      url: CALIBRATION_RPC_URL, // Ensure this URL is correct
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      chainId: CALIBRATION_CHAIN_ID, // Expecting 314159
    },

    // --- Optional: Base Sepolia (Keep or remove) ---
    // [BASE_SEPOLIA_NETWORK_KEY]: {
    //   url: BASE_SEPOLIA_RPC_URL,
    //   accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    //   chainId: BASE_SEPOLIA_CHAIN_ID,
    // },

    hardhat: { chainId: 31337 },
  },
  etherscan: {
    apiKey: {
       [CALIBRATION_NETWORK_KEY]: ETHERSCAN_API_KEY,
       // [BASE_SEPOLIA_NETWORK_KEY]: ETHERSCAN_API_KEY,
    },
    customChains: [
         {
             network: CALIBRATION_NETWORK_KEY,
             chainId: CALIBRATION_CHAIN_ID,
             urls: {
               apiURL: CALIBRATION_EXPLORER_API_URL,
               browserURL: CALIBRATION_EXPLORER_BROWSER_URL
             }
        },
        // Add Base Sepolia definition if needed
        // { network: BASE_SEPOLIA_NETWORK_KEY, ... }
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
};

export default config;