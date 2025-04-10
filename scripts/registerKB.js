// scripts/registerKB.js (Updated for Localhost)
import { ethers } from "ethers";
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// --- .env path resolution ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../packages/backend/.env');
dotenv.config({ path: envPath });
console.log(`[Register KB] Loading .env from: ${envPath}`);

// --- Determine if running local ---
const IS_LOCAL_TEST = !!process.env.LOCALHOST_RPC_URL;

// --- Configuration ---
// Use local owner key if running local, otherwise use default owner key
const OWNER_PRIVATE_KEY = IS_LOCAL_TEST ? process.env.LOCALHOST_OWNER_PRIVATE_KEY : (process.env.WALLET_PRIVATE_KEY || process.env.RECALL_PRIVATE_KEY);
// Use local contract address if running local
const AGGREGATOR_CONTRACT_ADDRESS = IS_LOCAL_TEST ? process.env.LOCALHOST_ZKP_AGGREGATOR_ADDRESS : process.env.ZKP_AGGREGATOR_CONTRACT_ADDRESS;
// Use local RPC if running local
const RPC_URL = IS_LOCAL_TEST ? process.env.LOCALHOST_RPC_URL : (process.env.L2_RPC_URL || process.env.FVM_RPC_URL);


// --- Arguments from command line ---
const args = process.argv.slice(2);
if (args.length !== 3) {
  console.error("\nUsage: node scripts/registerKB.js <requestContext> <knowledgeBaseFilePath> <expectedContentHash>");
  console.error("  <knowledgeBaseFilePath> should be relative to the 'scripts' directory (e.g., ./knowledge_source/paper.txt)");
  console.error("  <expectedContentHash> must be a 0x-prefixed 32-byte hex string (keccak256 hash)");
  console.error("\nExample: node scripts/registerKB.js req_test_123 ./knowledge_source/paper.txt 0xabc123...");
  process.exit(1);
}
const requestContext = args[0];
const relativeKbFilePath = args[1];
const expectedContentHash = args[2]; // Hash provided directly
const kbFilePath = path.resolve(__dirname, relativeKbFilePath);
console.log(`[Register KB] Resolved KB File Path: ${kbFilePath}`); // Log resolved path for debugging

// --- Input Validation ---
if (!OWNER_PRIVATE_KEY) { console.error(`FATAL: ${IS_LOCAL_TEST ? 'LOCALHOST_OWNER_PRIVATE_KEY' : 'WALLET/RECALL_PRIVATE_KEY'} not found in .env`); process.exit(1); }
if (!AGGREGATOR_CONTRACT_ADDRESS) { console.error(`FATAL: ${IS_LOCAL_TEST ? 'LOCALHOST_ZKP_AGGREGATOR_ADDRESS' : 'ZKP_AGGREGATOR_CONTRACT_ADDRESS'} not found in .env`); process.exit(1); }
if (!RPC_URL) { console.error(`FATAL: RPC URL (${IS_LOCAL_TEST ? 'LOCALHOST_RPC_URL' : 'L2/FVM_RPC_URL'}) not found in .env`); process.exit(1); }
if (!ethers.utils.isHexString(expectedContentHash, 32)) { console.error("FATAL: Invalid expectedContentHash provided."); process.exit(1); }


// --- Ethers Setup ---
let provider;
let wallet;
let aggregatorContract;
let contractAbi;

try {
    provider = new ethers.providers.StaticJsonRpcProvider(RPC_URL);
    wallet = new ethers.Wallet(OWNER_PRIVATE_KEY, provider);

    // Load ABI (remains the same)
    const abiPath = path.resolve(__dirname, "../packages/contracts/artifacts/contracts/ZKPEvaluatorAggregator.sol/ZKPEvaluatorAggregator.json");
    if (!fs.existsSync(abiPath)) throw new Error(`ABI file not found: ${abiPath}. Compile contracts.`);
    const abiJsonString = fs.readFileSync(abiPath, 'utf8');
    const contractAbiJson = JSON.parse(abiJsonString);
    contractAbi = contractAbiJson.abi;
    if (!contractAbi || contractAbi.length === 0) throw new Error("Failed to load contract ABI.");

    aggregatorContract = new ethers.Contract(AGGREGATOR_CONTRACT_ADDRESS, contractAbi, wallet);
    console.log(`Using Owner Wallet: ${wallet.address}`);
    console.log(`Connected to RPC: ${RPC_URL}`);
    console.log(`Target Contract: ${AGGREGATOR_CONTRACT_ADDRESS}`);
} catch (err) {
    console.error("FATAL: Failed to initialize ethers:", err);
    process.exit(1);
}

// --- Main Logic ---
async function registerKB() {
    console.log(`\nRegistering KB for Context: ${requestContext} on ${IS_LOCAL_TEST ? 'Localhost' : 'Calibration'}`);
    console.log(`  Expected Content Hash: ${expectedContentHash}`);

    try {
        console.log("Checking existing registration...");
        const existingInfo = await aggregatorContract.kbFilings(requestContext);
        if (existingInfo && existingInfo.registered === true) {
             if (existingInfo.contentHash?.toLowerCase() === expectedContentHash.toLowerCase()) {
                console.log("KB hash already registered correctly for this context.");
                return;
            } else {
                console.warn(`WARNING: KB already registered for ${requestContext} with DIFFERENT hash (${existingInfo.contentHash}). Cannot overwrite.`);
                return; // Exit without error, but indicate issue
            }
        } else {
            console.log("No existing registration found or 'registered' flag is false.");
        }

    console.log(`[Register KB DEBUG] Hash being sent to contract: ${expectedContentHash}`);
        console.log("Sending transaction to registerKnowledgeBase...");
        const tx = await aggregatorContract.registerKnowledgeBase(requestContext, expectedContentHash);
        console.log(`Transaction Sent: ${tx.hash}`);
        console.log("Waiting for confirmation...");
        const receipt = await tx.wait();

        if (receipt.status === 1) {
            console.log(`Transaction Confirmed in block: ${receipt.blockNumber}`);
            console.log("Knowledge Base hash registered successfully!");
        } else {
            console.error(`Transaction Failed (Reverted). Status: ${receipt.status}`);
            process.exit(1);
        }
    } catch (error) {
        console.error("\nError during registration:");
        // ...(error handling)...
         if (error.code === 'CALL_EXCEPTION') console.error("  Reason: Contract execution reverted.");
         else if (error.code === 'NETWORK_ERROR') console.error("  Reason: Network connection issue.");
         else if (error.code === 'INSUFFICIENT_FUNDS') console.error("  Reason: Deployer account insufficient funds.");
         else console.error(`  Message: ${error.message}`);
         if (error.transactionHash) console.error(`  Transaction: ${error.transactionHash}`);
        process.exit(1);
    }
}

// --- Execution ---
if (aggregatorContract && typeof aggregatorContract.registerKnowledgeBase === 'function') {
    registerKB();
} else {
    console.error("FATAL: Contract instance invalid or missing function.");
    process.exit(1);
}
