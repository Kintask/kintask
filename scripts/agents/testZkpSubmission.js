// ROOT/scripts/agents/testZkpSubmission.js (Simplified ZKP Test - Re-enabled KB Check)

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { privateKeyToAccount } from 'viem/accounts';
import { getAddress } from 'viem';
import { ethers } from 'ethers';
import * as snarkjs from "snarkjs";

// --- Import Utilities ---
import { hashData, hashToBigInt } from './agentUtils.js';

// --- .env path resolution ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../../packages/backend/.env');
dotenv.config({ path: envPath });
console.log(`[ZKP Test Script] Loading .env from backend: ${envPath}`);

// --- Determine if running local test ---
const IS_LOCAL_TEST = !!process.env.LOCALHOST_RPC_URL;

// --- Hardcoded Test Data ---
const TEST_REQUEST_CONTEXT = process.env.TEST_CONTEXT_ID || (IS_LOCAL_TEST ? "req_zkp_local_final_v2" : "req_zkp_calib_001"); // Use the last registered local context
const KB_FILE_PATH_RELATIVE_TO_SCRIPT = '../knowledge_source/paper.txt'; // Path relative to this script (agents/)
const KB_FILE_PATH = path.resolve(__dirname, KB_FILE_PATH_RELATIVE_TO_SCRIPT);
let TEST_KB_CONTENT_FOR_HASH;
try { if (!fs.existsSync(KB_FILE_PATH)) throw new Error(`KB file not found: ${KB_FILE_PATH}`); TEST_KB_CONTENT_FOR_HASH = fs.readFileSync(KB_FILE_PATH, 'utf8'); } catch (e) { console.error(`[ZKP Test Script] FATAL: Could not read KB file: ${e.message}`); process.exit(1); }
const TEST_QUESTION = process.env.TEST_QUESTION_STRING || "Local test question?";
const TEST_ANSWER = process.env.TEST_ANSWER_STRING || "Local test answer.";
const TEST_RAW_LLM_RESPONSE = process.env.TEST_LLM_RAW || "Local Verdict: Correct, Confidence: 0.88";
const TEST_CLAIMED_VERDICT = 1;
const TEST_CLAIMED_CONFIDENCE = 88;
const TEST_DEAL_ID = BigInt(process.env.TEST_DEAL_ID || "12345");

console.log(`--- Using Test Data (${IS_LOCAL_TEST ? 'Local' : 'Calibration'}) ---`);
console.log(`Request Context: ${TEST_REQUEST_CONTEXT}`);
console.log(`KB Content Snippet: "${TEST_KB_CONTENT_FOR_HASH.substring(0, 70).replace(/\n/g,' ')}..."`);
console.log(`Question: "${TEST_QUESTION}"`);
console.log(`Answer: "${TEST_ANSWER}"`);
console.log(`Claimed Verdict: ${TEST_CLAIMED_VERDICT}, Confidence: ${TEST_CLAIMED_CONFIDENCE}`);
console.log(`Simulated Deal ID: ${TEST_DEAL_ID}`);
console.log("-----------------------");


// --- Derive Submitter ID using appropriate Key ---
let SUBMITTER_ADDRESS;
let SUBMITTER_PRIVATE_KEY;
try {
    if (IS_LOCAL_TEST) { console.log("[ZKP Test Script] Using LOCALHOST_OWNER_PRIVATE_KEY for submission."); SUBMITTER_PRIVATE_KEY = process.env.LOCALHOST_OWNER_PRIVATE_KEY; if (!SUBMITTER_PRIVATE_KEY) throw new Error('LOCALHOST_OWNER_PRIVATE_KEY missing'); }
    else { console.log("[ZKP Test Script] Using WALLET_PRIVATE_KEY/RECALL_PRIVATE_KEY for submission."); SUBMITTER_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY || process.env.RECALL_PRIVATE_KEY; if (!SUBMITTER_PRIVATE_KEY) throw new Error('WALLET/RECALL_PRIVATE_KEY missing'); }
    const formattedPrivateKey = SUBMITTER_PRIVATE_KEY.startsWith('0x') ? SUBMITTER_PRIVATE_KEY : `0x${SUBMITTER_PRIVATE_KEY}`;
    const viemAccount = privateKeyToAccount(formattedPrivateKey);
    SUBMITTER_ADDRESS = getAddress(viemAccount.address);
    console.log(`[ZKP Test Script] Submitter Wallet Address: ${SUBMITTER_ADDRESS}`);
} catch (error) { console.error("[ZKP Test Script] FATAL: Could not derive submitter wallet address.", error); process.exit(1); }

// --- ZKP Config ---
const ZKP_CIRCUIT_WASM_PATH = path.resolve(__dirname, "../../packages/contracts/circuits/evaluator/build/evaluator_js/evaluator.wasm");
const ZKP_CIRCUIT_ZKEY_PATH = path.resolve(__dirname, "../../packages/contracts/circuits/evaluator/build/evaluator_final.zkey");

// --- Contract Setup ---
const AGGREGATOR_CONTRACT_ADDRESS = IS_LOCAL_TEST ? process.env.LOCALHOST_ZKP_AGGREGATOR_ADDRESS : process.env.ZKP_AGGREGATOR_CONTRACT_ADDRESS;
let provider;
let wallet;
let aggregatorContract;
let contractAbi;
if (!AGGREGATOR_CONTRACT_ADDRESS) { console.error(`FATAL: Appropriate Aggregator Address not found.`); process.exit(1); }
try {
    const rpcUrl = IS_LOCAL_TEST ? process.env.LOCALHOST_RPC_URL : (process.env.L2_RPC_URL || process.env.FVM_RPC_URL);
    if (!rpcUrl) throw new Error(`RPC URL not found.`);
    provider = new ethers.providers.StaticJsonRpcProvider(rpcUrl);
    wallet = new ethers.Wallet(SUBMITTER_PRIVATE_KEY, provider);
    if (getAddress(wallet.address) !== SUBMITTER_ADDRESS) { console.error(`[ZKP Test Script] FATAL: Wallet address mismatch.`); process.exit(1); }
    const abiPath = path.resolve(__dirname, "../../packages/contracts/artifacts/contracts/ZKPEvaluatorAggregator.sol/ZKPEvaluatorAggregator.json");
    if (!fs.existsSync(abiPath)) throw new Error(`ABI file not found: ${abiPath}`);
    const abiJsonString = fs.readFileSync(abiPath, 'utf8');
    const contractAbiJson = JSON.parse(abiJsonString);
    contractAbi = contractAbiJson.abi;
    if (!contractAbi || contractAbi.length === 0) throw new Error("ABI load/parse failed.");
    aggregatorContract = new ethers.Contract(AGGREGATOR_CONTRACT_ADDRESS, contractAbi, wallet);
    console.log(`Submitting Wallet: ${wallet.address}`);
    console.log(`Connected to RPC: ${rpcUrl}`);
    console.log(`Target Contract: ${AGGREGATOR_CONTRACT_ADDRESS}`);
} catch (err) { console.error("FATAL: Failed init ethers/ABI:", err); process.exit(1); }

// --- ZKP Generation Function ---
async function generateProof(inputs) { /* ... no change ... */
     console.log("[ZKP Test Script] Generating ZKP proof...");
     try { const { proof, publicSignals } = await snarkjs.groth16.fullProve(inputs, ZKP_CIRCUIT_WASM_PATH, ZKP_CIRCUIT_ZKEY_PATH); console.log("[ZKP Test Script] ZKP Proof generated successfully."); const formattedProof = { a: [proof.pi_a[0], proof.pi_a[1]], b: [ [proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]] ], c: [proof.pi_c[0], proof.pi_c[1]] }; const formattedPublicSignals = publicSignals.map(ps => BigInt(ps).toString()); return { proof: formattedProof, publicSignals: formattedPublicSignals }; } catch (err) { console.error("[ZKP Test Script] Error generating ZKP proof:", err); return null; }
 }

// --- Contract Interaction Function ---
async function submitEvaluationToContract(requestContext, proof, publicSignals, dealId) { /* ... no change ... */
    console.log(`[ZKP Test Script] Submitting evaluation & Deal ID ${dealId} to contract for context ${requestContext}...`);
    console.log("   Public Signals being sent:", publicSignals);
    try {
        const tx = await aggregatorContract.submitVerifiedEvaluation( requestContext, SUBMITTER_ADDRESS, proof.a, proof.b, proof.c, publicSignals, dealId, { gasLimit: 20000000 } );
        console.log(`[ZKP Test Script] Transaction sent: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log(`[ZKP Test Script] Transaction confirmed in block: ${receipt.blockNumber} | Gas Used: ${receipt.gasUsed.toString()}`);
        const eventName = "EvaluationVerified";
        const verifiedEvent = receipt.events?.find(e => e.event === eventName);
        if (verifiedEvent) { console.log(`[ZKP Test Script] Contract emitted ${eventName} event. SUCCESS!`); return { success: true, txHash: tx.hash }; }
        else { const failedEvent = receipt.events?.find(e => e.event === "EvaluationFailed"); if (failedEvent) { const reason = failedEvent.args?.reason || "Unknown"; console.error(`[ZKP Test Script] Contract emitted EvaluationFailed: ${reason}`); return { success: false, error: `Contract verification failed: ${reason}`, txHash: tx.hash }; } else { if (receipt.status === 0) { console.error(`[ZKP Test Script] Tx reverted (Status 0). Tx: ${tx.hash}`); return { success: false, error: "Transaction reverted", txHash: tx.hash }; } console.error(`[ZKP Test Script] Tx confirmed (Status ${receipt.status}), but expected event not found.`); return { success: false, error: "Contract status unclear.", txHash: tx.hash }; } }
    } catch (error) { const reason = error.reason || error.error?.reason || error.message || String(error); console.error(`[ZKP Test Script] Error submitting:`, reason); if(error.transactionHash) console.error(`  Failing Transaction: ${error.transactionHash}`); return { success: false, error: reason }; }
}

// --- Main Execution ---
async function runTest() {
    console.log(`[ZKP Test Script ${new Date().toISOString()}] Starting test run...`);

    // *** PERFORM KB Check ***
    let registeredKbHash = ethers.constants.HashZero;
    try {
        console.log(`[ZKP Test Script] Checking registration status for context: ${TEST_REQUEST_CONTEXT}`);
        const kbInfo = await aggregatorContract.kbFilings(TEST_REQUEST_CONTEXT);
        // We expect this to succeed now because we ran registerKB.js for this context
        if (!kbInfo || kbInfo.registered !== true || !kbInfo.contentHash || kbInfo.contentHash === ethers.constants.HashZero) {
            console.error(`[ZKP Test Script] FAILURE: KB Info NOT registered correctly for context '${TEST_REQUEST_CONTEXT}'. Register it first.`);
            process.exit(1);
        }
        registeredKbHash = kbInfo.contentHash;
        console.log(`[ZKP Test Script] Found registered KB Hash on-chain: ${registeredKbHash}`);
    } catch (readError) {
        console.error(`[ZKP Test Script] Error reading KB status:`, readError);
        process.exit(1);
    }

    // 1. Calculate Hashes
    const requestContextHash = hashToBigInt(hashData(TEST_REQUEST_CONTEXT));
    const kbContentHash = hashToBigInt(hashData(TEST_KB_CONTENT_FOR_HASH)); // Hash the file content
    const questionHash = hashToBigInt(hashData(TEST_QUESTION));
    const answerHash = hashToBigInt(hashData(TEST_ANSWER));
    const llmResponseHash = hashToBigInt(hashData(TEST_RAW_LLM_RESPONSE));
    const answeringAgentIdBigInt = BigInt(SUBMITTER_ADDRESS); // Use submitter address for ZKP input consistency check
    console.log(`[ZKP Test Script] Agent Address used for ZKP Input [5]: ${SUBMITTER_ADDRESS} -> ${answeringAgentIdBigInt.toString()}`);


    // *** Compare Hashes ***
    const calculatedKbHashHex = ethers.utils.hexlify(kbContentHash);
    console.log(`[ZKP Test Script] Calculated KB Hash for ZKP Input [1]: ${calculatedKbHashHex}`);
    // Compare against the hash read from the contract
    if (calculatedKbHashHex.toLowerCase() !== registeredKbHash.toLowerCase()) {
         console.error(`[ZKP Test Script] FATAL MISMATCH: Calculated KB hash (${calculatedKbHashHex}) does not match registered hash (${registeredKbHash}).`);
         process.exit(1);
     } else {
         console.log("[ZKP Test Script] KB Hashes match. Proceeding...");
     }


    // 2. Prepare ZKP Inputs
    const claimedVerdict = BigInt(TEST_CLAIMED_VERDICT);
    const claimedConfidence = BigInt(TEST_CLAIMED_CONFIDENCE);
    const parsedVerdictCode = claimedVerdict;
    const parsedConfidenceScaled = claimedConfidence;
    const circuitInputs = {
        requestContextHash: requestContextHash.toString(), kbContentHash: kbContentHash.toString(),
        questionHash: questionHash.toString(), answerHash: answerHash.toString(),
        llmResponseHash: llmResponseHash.toString(), answeringAgentId: answeringAgentIdBigInt.toString(),
        evaluationVerdict: claimedVerdict, // Pass BigInts
        evaluationConfidence: claimedConfidence,
        parsedVerdictCode: parsedVerdictCode,
        parsedConfidenceScaled: parsedConfidenceScaled
    };

    // 3. Generate ZKP
    const proofData = await generateProof(circuitInputs);
    if (!proofData) { console.error(`[ZKP Test Script] Failed ZKP generation.`); process.exit(1); }

    // 4. Submit to Contract
    const submissionResult = await submitEvaluationToContract(
        TEST_REQUEST_CONTEXT, proofData.proof, proofData.publicSignals, TEST_DEAL_ID
    );

    if (submissionResult.success) { console.log(`[ZKP Test Script] Test completed successfully. Tx: ${submissionResult.txHash}`); }
    else { console.error(`[ZKP Test Script] Test failed: ${submissionResult.error}`); process.exit(1); }
}

// --- Run the Test ---
if (aggregatorContract && typeof aggregatorContract.submitVerifiedEvaluation === 'function') {
    runTest().catch(error => { console.error("[ZKP Test Script] Unexpected error:", error); process.exit(1); });
} else { console.error("FATAL: Contract instance invalid or missing 'submitVerifiedEvaluation'."); process.exit(1); }

