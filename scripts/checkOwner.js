// scripts/checkContract.js
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../packages/backend/.env');
dotenv.config({ path: envPath });
console.log(`[Check Contract] Loading .env from: ${envPath}`);

const IS_LOCAL_TEST = process.env.IS_LOCAL_TEST === 'true';

const RPC_URL = IS_LOCAL_TEST
    ? process.env.LOCALHOST_RPC_URL
    : (process.env.L2_RPC_URL || process.env.FVM_RPC_URL);

const CONTRACT_ADDRESS = IS_LOCAL_TEST
    ? process.env.LOCALHOST_ZKP_AGGREGATOR_ADDRESS
    : process.env.ZKP_AGGREGATOR_CONTRACT_ADDRESS;

if (!RPC_URL || !CONTRACT_ADDRESS) {
    console.error("FATAL: RPC_URL or ZKP_AGGREGATOR_CONTRACT_ADDRESS not found in .env for the selected network.");
    process.exit(1);
}

async function checkOwner() {
    console.log(`[Check Contract] Network: ${IS_LOCAL_TEST ? 'Localhost' : 'Calibration'}`);
    console.log(`[Check Contract] RPC URL: ${RPC_URL}`);
    console.log(`[Check Contract] Contract Address: ${CONTRACT_ADDRESS}`);

    let provider;
    try {
        provider = new ethers.providers.StaticJsonRpcProvider(RPC_URL);
        const network = await provider.getNetwork();
        console.log(`[Check Contract] Connected to Network: ${network.name} (Chain ID: ${network.chainId})`);
    } catch (err) {
        console.error(`[Check Contract] Failed to connect provider: ${err.message}`);
        return;
    }

    const aggAbiPath = path.resolve(__dirname, "../packages/contracts/artifacts/contracts/ZKPEvaluatorAggregator.sol/ZKPEvaluatorAggregator.json");
    let contractAbi;
    try {
        if (!fs.existsSync(aggAbiPath)) throw new Error(`ABI file not found: ${aggAbiPath}`);
        const aggAbiJsonString = fs.readFileSync(aggAbiPath, 'utf8');
        const aggContractAbiJson = JSON.parse(aggAbiJsonString);
        contractAbi = aggContractAbiJson.abi;
        if (!contractAbi || contractAbi.length === 0) throw new Error("Agg ABI load failed.");
        console.log("[Check Contract] ABI loaded successfully.");
    } catch (err) {
        console.error(`[Check Contract] Failed to load ABI: ${err.message}`);
        return;
    }

    try {
        const contract = new ethers.Contract(CONTRACT_ADDRESS, contractAbi, provider);
        console.log(`[Check Contract] Calling owner() on ${contract.address}...`);
        const ownerAddress = await contract.owner();
        console.log(`[Check Contract] SUCCESS! Owner address: ${ownerAddress}`);
        console.log(`[Check Contract] This confirms the contract exists at the address and the ABI allows calling owner().`);
    } catch (error) {
        console.error(`[Check Contract] FAILED to call owner():`);
        const reason = error.reason || error.message || String(error);
        console.error(`   Reason: ${reason}`);
        if (error.code === 'CALL_EXCEPTION') {
            console.error(`   This CALL_EXCEPTION likely means the contract doesn't exist at ${CONTRACT_ADDRESS} on network ${RPC_URL}, or the ABI is incorrect.`);
        }
        console.error(`   Full Error:`, error);
    }
}

checkOwner();