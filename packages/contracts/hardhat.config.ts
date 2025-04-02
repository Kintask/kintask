// packages/contracts/hardhat.config.ts
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox"; // Includes typechain, ethers, waffle etc.
import "@nomicfoundation/hardhat-verify"; // For Etherscan verification
import dotenv from 'dotenv';

dotenv.config(); // Load root .env variables for contract deployment

const L2_RPC_URL = process.env.L2_RPC_URL || "https://sepolia.base.org"; // Default public RPC if not set
const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY || "";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

if (!WALLET_PRIVATE_KEY) {
  console.warn("WARNING: WALLET_PRIVATE_KEY not set in packages/contracts/.env, deployment/transactions will fail.");
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24", // Match Blocklock solidity version requirement if needed
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    // Define your L2 Testnet here (e.g., baseSepolia)
    l2testnet: { // Rename this key (e.g., baseSepolia, optSepolia)
      url: L2_RPC_URL,
      accounts: WALLET_PRIVATE_KEY ? [WALLET_PRIVATE_KEY] : [],
      chainId: 84532, // Example: Base Sepolia Chain ID - **CHANGE THIS**
    },
    // Add other networks like localhost if needed
    hardhat: {
        // Configuration for local testing network
    },
  },
  etherscan: {
    // Your API key for Etherscan/Blockscout verification
    apiKey: {
       l2testnet: ETHERSCAN_API_KEY // Use the same network key as above
       // Example for Base Sepolia:
       // baseSepolia: ETHERSCAN_API_KEY
    },
    customChains: [ // Add custom chain definition if not natively supported by hardhat-verify
         {
             network: "l2testnet", // Must match the network key above
             chainId: 84532, // **CHANGE THIS** to your L2 testnet chain ID
             urls: {
               apiURL: "https://api-sepolia.basescan.org/api", // Example: Base Sepolia API URL - **CHANGE THIS**
               browserURL: "https://sepolia.basescan.org" // Example: Base Sepolia Browser URL - **CHANGE THIS**
             }
        }
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
    target: "ethers-v6", // Ensure compatibility with ethers v6
  },
};

export default config;