// scripts/checkContract.js (ESM Version using import - No Shebang)

// Use ESM import syntax
import { ethers } from "ethers"; // Import ethers v5
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url'; // Needed for __dirname equivalent
// No need to import readline if not using it
// import * as readline from 'node:readline/promises';
import process from 'node:process'; // Explicit import for process

// --- Configuration ---
// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from packages/backend directory relative to scripts/agents
const envPath = path.resolve(__dirname, '../packages/backend/.env');
dotenv.config({ path: envPath });
console.log(`[Check Contract - ESM] Loading .env from: ${envPath}`);

// Get necessary details from environment variables
const rpcUrl = process.env.FVM_RPC_URL || "https://api.calibration.node.glif.io/rpc/v1"; // Default to GLIF
const contractAddress = process.env.FVM_AGGREGATOR_CONTRACT_ADDRESS;
// ABI - Minimal version needed just for owner()
const minimalAbi = [
  "function owner() view returns (address)"
];

// --- Main Function ---
async function checkContract() {
    console.log(`\n--- Contract Check (ESM) ---`);
    console.log(`RPC URL: ${rpcUrl}`);
    console.log(`Contract Address: ${contractAddress}`);

    if (!contractAddress) {
        console.error("❌ Error: FVM_AGGREGATOR_CONTRACT_ADDRESS not found in .env file.");
        process.exitCode = 1; // Indicate failure
        return;
    }
    if (!rpcUrl) {
        console.error("❌ Error: FVM_RPC_URL not found in .env file.");
        process.exitCode = 1; // Indicate failure
        return;
    }

    let provider; // Declare provider outside try block

    try {
        // 1. Connect Provider
        console.log("\nConnecting to provider...");
        // Use StaticJsonRpcProvider for specific endpoint
        provider = new ethers.providers.StaticJsonRpcProvider(rpcUrl);

        // 2. Check Network Connection
        const network = await provider.getNetwork();
        console.log(`✅ Connected to network: ${network.name} (Chain ID: ${network.chainId})`);

        // 3. Check if Code Exists at Address
        console.log(`\nChecking for code at address ${contractAddress}...`);
        const code = await provider.getCode(contractAddress);

        if (code === "0x" || code === "0x0") {
            console.error(`❌ Error: No bytecode found at address ${contractAddress} on this network.`);
            console.error(`   - Verify the contract address is correct.`);
            console.error(`   - Verify you are connected to the correct network (Calibration Chain ID: ${network.chainId}).`);
            console.error(`   - Verify the deployment transaction was successful and finalized.`);
            process.exitCode = 1;
            return;
        } else {
            console.log(`✅ Contract code found at address (Code length: ${code.length}, starts with: ${code.substring(0, 12)}...).`);
        }

        // 4. Create Contract Instance and Call owner()
        console.log("\nAttempting to call owner() function...");
        const contractInstance = new ethers.Contract(contractAddress, minimalAbi, provider);

        const ownerAddress = await contractInstance.owner();
        console.log(`✅ Successfully called owner(): ${ownerAddress}`);

        // Check if the owner is the zero address
        if (ownerAddress === ethers.constants.AddressZero) {
             console.warn("   ⚠️ Warning: owner() returned the zero address. Was the constructor executed correctly? Or is state missing?");
        }

        console.log("\n--- Check Complete ---");
        process.exitCode = 0; // Indicate success

    } catch (error) { // error type is unknown in plain JS catch
        console.error("\n❌ --- Error during contract check ---");
        // Attempt to access potential error properties safely
        const errorCode = error?.code;
        const errorMessage = error?.message || String(error);
        const errorReason = error?.reason;
        const errorRpcBody = error?.error?.body;
        const errorRpcMessage = error?.error?.message;
        const errorTransaction = error?.transaction;

        // Check specifically for ethers v5 call exception structure
        if (errorCode === 'CALL_EXCEPTION') { // Use string code comparison
             console.error("   Error Type: CALL_EXCEPTION (Transaction reverted or view call failed)");
             console.error("   Reason:", errorReason || "No specific reason provided by node.");
             // Log nested RPC error if available
             if(errorRpcBody || errorRpcMessage) {
                console.error("   RPC Error Details:", JSON.stringify(errorRpcBody || errorRpcMessage));
                const nestedErrorMessage = JSON.stringify(errorRpcBody || errorRpcMessage || '').toLowerCase();
                if (nestedErrorMessage.includes('actor not found')) {
                    console.error("   >> Hint: RPC node reports 'actor not found'. Double-check address and network sync status.");
                }
             } else if (errorTransaction) {
                 console.error("   Transaction Details (if available):", JSON.stringify(errorTransaction));
             }
        } else {
            // Log other types of errors
            console.error("   Error Type:", errorCode || error?.name || "Unknown");
            console.error("   Message:", errorMessage);
        }
        console.error("------------------------");
        process.exitCode = 1; // Indicate failure
    }
}

// Run the check
checkContract();

// ==== ./scripts/checkContract.js (ESM Version - No Shebang) ====