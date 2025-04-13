// answeringAgent.js (ES Module Syntax - Corrected for Ethers v5 and Errors, Payment Collection Commented Out)

import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath, pathToFileURL } from 'url'; // Keep pathToFileURL for dynamic imports
import { privateKeyToAccount } from "viem/accounts";
import { getAddress } from "viem";
import { ethers } from "ethers"; // Use Ethers v5 import
import * as snarkjs from "snarkjs";

// --- Import Utilities ---
import {
    // createEvidenceCar,
    // uploadCarFile,
    truncateText,
    hashData,
    hashToBigInt
} from './agentUtils.js'; // Keep .js extension for explicit ESM import

// --- Environment Variable Loading ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../../packages/backend/.env');

dotenv.config({ path: envPath });
console.log(`[Answering Agent] Loading .env from backend: ${envPath}`);

// --- Key Generation Helpers (Defined Locally) ---
const CONTEXT_DATA_PREFIX = "reqs/";
const getAnswerKey = (ctx, agentId) => {
    // Ensure agentId is checksummed before using in key
    const checksummedAgentId = getAddress(agentId);
    return `${CONTEXT_DATA_PREFIX}${ctx}/answers/${checksummedAgentId}.json`;
};

// --- Config & Deployment Info ---
const IS_LOCAL_TEST = process.env.IS_LOCAL_TEST === 'true';
const AGENT_GAS_LIMIT_ANSWER = BigInt(process.env.AGENT_GAS_LIMIT_ANSWER || '1000000');
const AGENT_GAS_LIMIT_VALIDATE = BigInt(process.env.AGENT_GAS_LIMIT_VALIDATE || '1500000');
const AGENT_GAS_LIMIT_COLLECT = BigInt(process.env.AGENT_GAS_LIMIT_COLLECT || '500000'); // Still defined, just not used in processQuestionJob
const AGENT_GAS_LIMIT_STRING_RESULT = BigInt(process.env.AGENT_GAS_LIMIT_STRING_RESULT || '500000');

// --- Helper: Send Local Test ETH (Using Ethers v5 syntax) ---
async function sendLocalTestEth() {
    if (IS_LOCAL_TEST) {
        try {
            console.log(`[Answering Agent] Sending initial ETH to local wallet...`);
            const hardhatDefaultPrivateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
            const localRpcUrl = process.env.LOCALHOST_RPC_URL || "http://127.0.0.1:8545";
            const targetWalletKey = process.env.LOCALHOST_OWNER_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY;
            if (!targetWalletKey) { throw new Error("No target wallet key found"); }
            const targetWallet = new ethers.Wallet(targetWalletKey);
            const targetAddress = targetWallet.address;
            const provider = new ethers.providers.JsonRpcProvider(localRpcUrl); // v5
            const signer = new ethers.Wallet(hardhatDefaultPrivateKey, provider);
            const signerBalance = await provider.getBalance(signer.address);
            console.log(`[Answering Agent] Source wallet (${signer.address}) balance: ${ethers.utils.formatEther(signerBalance)} ETH`); // v5
            const targetBalance = await provider.getBalance(targetAddress);
            console.log(`[Answering Agent] Target wallet (${targetAddress}) initial balance: ${ethers.utils.formatEther(targetBalance)} ETH`); // v5
            if (targetBalance.lt(ethers.utils.parseEther("0.1"))) { // v5
                const tx = await signer.sendTransaction({ to: targetAddress, value: ethers.utils.parseEther("1.0"), gasLimit: 100000 }); // v5
                console.log(`[Answering Agent] Sending 1 ETH to ${targetAddress}, tx hash: ${tx.hash}`);
                await tx.wait();
                const newBalance = await provider.getBalance(targetAddress);
                console.log(`[Answering Agent] Target wallet (${targetAddress}) new balance: ${ethers.utils.formatEther(newBalance)} ETH`); // v5
            } else { console.log(`[Answering Agent] Target wallet already has sufficient ETH (${ethers.utils.formatEther(targetBalance)} ETH)`); }
        } catch (error) {
             const errorMessage = error instanceof Error ? error.message : String(error);
             console.error(`[Answering Agent] Error sending local test ETH: ${errorMessage}`);
        }
    }
}
await sendLocalTestEth(); // Top-level await okay in ESM

// --- CONTRACT ADDRESSES ---
const getConfigValue = (key, required = true, defaultValue) => {
    const value = process.env[key];
    if (!value && required && defaultValue === undefined) { throw new Error(`Missing required environment variable: ${key}`); }
    if (!value && defaultValue !== undefined) { console.warn(`[Answering Agent] Using default value for ${key}: ${defaultValue}`); return defaultValue; }
    return value;
};
const ANSWER_STATEMENT_ADDRESS = getConfigValue('ANSWER_STATEMENT_ADDRESS');
const ZKPVALIDATOR_ADDRESS = getConfigValue('ZKP_VALIDATOR_ADDRESS');
const ERC20_PAYMENT_STATEMENT_ADDRESS = getConfigValue('ERC20_PAYMENT_STATEMENT_ADDRESS');
const EAS_ADDRESS = getConfigValue('EAS_CONTRACT_ADDRESS');
const STRING_RESULT_STATEMENT_ADDRESS = getConfigValue('STRING_RESULT_STATEMENT_ADDRESS', false, ethers.constants.AddressZero); // v5


// --- Load contract ABIs ---
function loadAbi(contractName) {
    const abiPath = path.resolve(__dirname, `../../packages/contracts/artifacts/contracts/${contractName}.sol/${contractName}.json`);
    try { return JSON.parse(fs.readFileSync(abiPath, 'utf8')).abi; }
    catch (error) {
         const externalAbiPath = path.resolve(__dirname, `../../packages/contracts/artifacts/contracts/external/${contractName}.sol/${contractName}.json`);
         console.warn(`[Answering Agent] ABI not found at ${abiPath}, trying ${externalAbiPath}...`);
         try { return JSON.parse(fs.readFileSync(externalAbiPath, 'utf8')).abi; }
         catch (error2) { console.error(`[Answering Agent] Failed to load ABI for ${contractName} from both paths: ${error2.message}`); throw new Error(`Failed to load ABI for ${contractName}`); }
    }
}
const answerStatementABI = loadAbi("AnswerStatement");
const zkpValidatorABI = loadAbi("ZKPValidator");
const erc20PaymentStatementABI = loadAbi("ERC20PaymentStatement");
const stringResultStatementABI = loadAbi("StringResultStatement");
const easABI = loadAbi("EAS");

// --- Agent Identity ---
let AGENT_ADDRESS;
let AGENT_PRIVATE_KEY;
try {
    const rawPrivateKey = process.env.AGENT_PRIVATE_KEY || process.env.RECALL_PRIVATE_KEY;
    if (!rawPrivateKey) throw new Error('AGENT_PRIVATE_KEY or RECALL_PRIVATE_KEY must be set');
    AGENT_PRIVATE_KEY = rawPrivateKey.startsWith('0x') ? rawPrivateKey : `0x${rawPrivateKey}`;
    const viemAccount = privateKeyToAccount(AGENT_PRIVATE_KEY);
    AGENT_ADDRESS = getAddress(viemAccount.address);
    console.log(`[Answering Agent] Agent Address: ${AGENT_ADDRESS}`);
} catch (error) { const errorMessage = error instanceof Error ? error.message : String(error); console.error("[Answering Agent] FATAL: Derive agent ID failed.", errorMessage); process.exit(1); }

// --- ZKP Configuration ---
const ZKP_CIRCUIT_WASM_PATH = path.resolve(__dirname, "../../packages/contracts/circuits/alwaystrue/build/alwaystrue_js/AlwaysTrue.wasm");
const ZKP_CIRCUIT_ZKEY_PATH = path.resolve(__dirname, "../../packages/contracts/circuits/alwaystrue/build/alwaystrue_final.zkey");
if (!fs.existsSync(ZKP_CIRCUIT_WASM_PATH)) console.warn(`[Answering Agent] ZKP WASM file not found: ${ZKP_CIRCUIT_WASM_PATH}`);
if (!fs.existsSync(ZKP_CIRCUIT_ZKEY_PATH)) console.warn(`[Answering Agent] ZKP ZKEY file not found: ${ZKP_CIRCUIT_ZKEY_PATH}`);
console.log(`[Answering Agent] Using WASM: ${ZKP_CIRCUIT_WASM_PATH}`);
console.log(`[Answering Agent] Using ZKEY: ${ZKP_CIRCUIT_ZKEY_PATH}`);


// --- Service Imports (Dynamic) ---
const servicesBasePath = path.resolve(__dirname, '../../packages/backend/dist/services');
const recallServicePath = path.join(servicesBasePath, 'recallService.js');
const filecoinServicePath = path.join(servicesBasePath, 'filecoinService.js');
const generatorServicePath = path.join(servicesBasePath, 'generatorService.js');

let generateAnswerFromContent;
let getPendingJobs;
let getObjectData;
let logAnswer; // Signature should accept validationUID: (answer, agentId, context, fulfillmentUID, validationUID?)
let fetchContentByCid;
// ADDED: Import addObjectToBucket if logAgentCollection is defined locally
let addObjectToBucket;

try {
    console.log(`[Answering Agent] Importing backend services dynamically from ${servicesBasePath}...`);
    const recallService = await import(pathToFileURL(recallServicePath).toString());
    getPendingJobs = recallService.getPendingJobs;
    getObjectData = recallService.getObjectData;
    logAnswer = recallService.logAnswer;
    addObjectToBucket = recallService.addObjectToBucket; // Import for local logging function

    const filecoinService = await import(pathToFileURL(filecoinServicePath).toString());
    fetchContentByCid = filecoinService.fetchContentByCid;
    const generatorService = await import(pathToFileURL(generatorServicePath).toString());
    generateAnswerFromContent = generatorService.generateAnswerFromContent;

    if (!getPendingJobs || !getObjectData || !logAnswer || !fetchContentByCid || !generateAnswerFromContent || !addObjectToBucket) {
        throw new Error("One or more required service functions not found after dynamic import.");
    }
    console.log('[Answering Agent] Required backend services imported successfully.');
} catch (importError) { const errorMessage = importError instanceof Error ? importError.message : String(importError); console.error("[Answering Agent] FATAL: Backend service import failed.", errorMessage); process.exit(1); }

// --- Ethers.js Contract Setup (Using Ethers v5 syntax) ---
const rpcUrl = IS_LOCAL_TEST ? (process.env.LOCALHOST_RPC_URL || "http://127.0.0.1:8545") : (process.env.L2_RPC_URL || process.env.FVM_RPC_URL);
if (!rpcUrl) { console.error("[Answering Agent] FATAL: No RPC URL configured."); process.exit(1); }
console.log(`[Answering Agent] Using RPC URL: ${rpcUrl} (IS_LOCAL_TEST: ${IS_LOCAL_TEST})`);

const provider = new ethers.providers.JsonRpcProvider(rpcUrl); // v5
const agentWallet = new ethers.Wallet(AGENT_PRIVATE_KEY, provider);
console.log(`[Answering Agent] Signing transactions with agent wallet: ${agentWallet.address}`);
if (agentWallet.address.toLowerCase() !== AGENT_ADDRESS.toLowerCase()) { console.error(`[Answering Agent] FATAL: Mismatch between AGENT_ADDRESS and agentWallet address.`); process.exit(1); }

// Initialize contract instances
const answerStatement = new ethers.Contract(ANSWER_STATEMENT_ADDRESS, answerStatementABI, agentWallet);
const zkpValidator = new ethers.Contract(ZKPVALIDATOR_ADDRESS, zkpValidatorABI, agentWallet);
const erc20PaymentStatement = new ethers.Contract(ERC20_PAYMENT_STATEMENT_ADDRESS, erc20PaymentStatementABI, agentWallet);
const stringResultStatement = new ethers.Contract(STRING_RESULT_STATEMENT_ADDRESS, stringResultStatementABI, agentWallet);
const eas = new ethers.Contract(EAS_ADDRESS, easABI, provider);


// --- Helper: Generate ZKP Proof ---
// --- Helper: Generate ZKP Proof ---
async function generateProofForAlwaysTrue(inputs) { // Expects an object like { input0: "1", ... }
    console.log("[Agent ZKP] Generating proof with inputs:", inputs);
    console.log("[Agent ZKP] WASM Path:", ZKP_CIRCUIT_WASM_PATH);
    console.log("[Agent ZKP] ZKEY Path:", ZKP_CIRCUIT_ZKEY_PATH);

    // --- File Existence Checks ---
    if (!fs.existsSync(ZKP_CIRCUIT_WASM_PATH)) {
        console.error(`[Agent ZKP] CRITICAL: WASM file not found at specified path: ${ZKP_CIRCUIT_WASM_PATH}`);
        throw new Error(`WASM file not found at ${ZKP_CIRCUIT_WASM_PATH}`);
    }
    if (!fs.existsSync(ZKP_CIRCUIT_ZKEY_PATH)) {
        console.error(`[Agent ZKP] CRITICAL: ZKEY file not found at specified path: ${ZKP_CIRCUIT_ZKEY_PATH}`);
        throw new Error(`ZKEY file not found at ${ZKP_CIRCUIT_ZKEY_PATH}`);
    }
    // --- End File Checks ---

    try {
        // Call snarkjs to generate the full proof and public signals
        console.log("[Agent ZKP] Calling snarkjs.groth16.fullProve...");
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
            inputs,
            ZKP_CIRCUIT_WASM_PATH,
            ZKP_CIRCUIT_ZKEY_PATH
            // Optionally add a logger here if snarkjs supports it:
            // , console // Example: pass console as a logger
        );
        console.log("[Agent ZKP] snarkjs call completed.");

        // --- Sanity Check snarkjs Output ---
        if (!proof || !publicSignals) {
             console.error("[Agent ZKP] CRITICAL: snarkjs.groth16.fullProve did not return expected structure (missing proof or publicSignals). Result:", { proof, publicSignals });
             throw new Error("snarkjs.groth16.fullProve did not return expected structure.");
        }
        if (!proof.pi_a || !proof.pi_b || !proof.pi_c) {
             console.error("[Agent ZKP] CRITICAL: snarkjs proof object is missing required fields (pi_a, pi_b, or pi_c). Proof:", proof);
            throw new Error("snarkjs proof object is missing required fields.");
        }
         // --- End Sanity Check ---


        // Format the proof structure for Solidity contract verification
        // IMPORTANT: Ensure the order [Beta, Alpha] for pi_b elements matches Verifier.sol
        const formattedProof = {
            a: [proof.pi_a[0], proof.pi_a[1]],
            b: [
                [proof.pi_b[0][1], proof.pi_b[0][0]], // Inner array: [Beta_1, Alpha_1]
                [proof.pi_b[1][1], proof.pi_b[1][0]]  // Inner array: [Beta_2, Alpha_2]
            ],
            c: [proof.pi_c[0], proof.pi_c[1]]
        };

        // Ensure publicSignals are returned as an array of strings
        const publicSignalsAsStringArray = publicSignals.map(signal => String(signal));

        console.log("[Agent ZKP] Proof generated and formatted successfully.");
        // Return both the formatted proof and the public signals
        return { proof: formattedProof, publicSignals: publicSignalsAsStringArray };

    } catch (zkpError) {
        // Log the specific error from snarkjs
        console.error("[Agent ZKP] snarkjs.groth16.fullProve FAILED:", zkpError);
        // Re-throw the error so it's caught by the calling function (processQuestionJob)
        throw zkpError;
    }
}
// --- Helper: Find UID from Receipt (Using Ethers v5 syntax) ---
async function findUIDFromReceipt( receipt, targetContractAddress, targetInterface, specificEventName, uidArgName, schemaUIDToCheck ) {
    console.log(`[Agent Log Parser] Searching for event '${specificEventName}' (arg: '${uidArgName}') in logs...`);
    const events = receipt.events || []; // Ethers v5
    for (const log of events) {
        if (log.address.toLowerCase() === targetContractAddress.toLowerCase() && log.event === specificEventName) {
            try {
                if (specificEventName === "Attested" && schemaUIDToCheck) { if (log.args.schema !== schemaUIDToCheck) { continue; } console.log(`[Agent Log Parser] Found 'Attested' event matching schema ${schemaUIDToCheck}.`); }
                const uid = log.args[uidArgName];
                if (uid && typeof uid === 'string' && uid !== ethers.constants.HashZero) { console.log(`[Agent Log Parser] Found UID in '${specificEventName}': ${uid}`); return uid; }
                else { console.warn(`[Agent Log Parser] Found '${specificEventName}' but UID arg '${uidArgName}' missing/empty/zero.`); }
            } catch (parseError) { console.warn(`[Agent Log Parser] Error parsing args for event '${specificEventName}': ${parseError.message}`); }
        }
    }
    // Fallback manual parse
     for (const log of receipt.logs) { if (log.address.toLowerCase() === targetContractAddress.toLowerCase()) { try { const parsedLog = targetInterface.parseLog(log); if (parsedLog.name === specificEventName) { if (specificEventName === "Attested" && schemaUIDToCheck) { if (parsedLog.args.schema !== schemaUIDToCheck) { continue; } console.log(`[Agent Log Parser] Found 'Attested' event (manual parse) matching schema ${schemaUIDToCheck}.`); } const uid = parsedLog.args[uidArgName]; if (uid && typeof uid === 'string' && uid !== ethers.constants.HashZero) { console.log(`[Agent Log Parser] Found UID in '${specificEventName}' (manual parse): ${uid}`); return uid; } } } catch {} } }
    console.warn(`[Agent Log Parser] UID not found for event '${specificEventName}' from address ${targetContractAddress}.`);
    return null;
}

// --- Helper: Log Agent Collection (Defined locally) ---
// Key generation helper needed here
const getAgentCollectionKey = (ctx, agentId, paymentUID) => `${CONTEXT_DATA_PREFIX}${ctx}/collections/${getAddress(agentId)}_${paymentUID.substring(0, 10)}.json`;
async function logAgentCollection(context, agentId, paymentUid, validationUid, collectTxHash, collectedAmountRaw) {
    const collectionKey = getAgentCollectionKey(context, agentId, paymentUid);
    const logData = { agentId: getAddress(agentId), requestContext: context, paymentUID: paymentUid, validationUID: validationUid, collectionTxHash: collectTxHash, collectedAmountRaw: collectedAmountRaw ? collectedAmountRaw.toString() : null, collectionTimestamp: new Date().toISOString(), message: "Payment collected by agent." };
    console.log(`[Agent] Logging successful payment collection to Recall key: ${collectionKey}`);
    try { const result = await addObjectToBucket(logData, collectionKey); if (!result.success && !result.keyExists) { console.warn(`[Agent] Failed to log agent collection event to recall: ${result.error}`); } else if (result.keyExists) { console.warn(`[Agent] Agent collection log already exists for key: ${collectionKey}`); } else { console.log(`[Agent] Agent collection event logged successfully.`); } }
    catch (error) { console.error(`[Agent] Error logging agent collection event: ${error.message}`); }
}


// --- Main Job Processing Function (Option B: Backend Collects - collectPayment commented out) ---
async function processQuestionJob(jobInfo) {
    const jobKey = jobInfo.key;
    console.log(`\n[Agent ${AGENT_ADDRESS.substring(0, 10)}] === Processing Job Key: ${jobKey} ===`);
    let jobData = null; let answerUID = null; let validationUID = null; let requestContext = null;

    try {
        // 1. Fetch Job Data
        jobData = jobInfo.data || await getObjectData(jobKey);
        if (!jobData?.cid || !jobData?.requestContext || !jobData?.question || !jobData.paymentUID) { console.warn(`[Agent] Invalid/incomplete job data ${jobKey}. Skip.`); return; }
        requestContext = jobData.requestContext; const question = jobData.question; const paymentUID = jobData.paymentUID;
        console.log(`[Agent] Job Details: Ctx=${requestContext}, Q=${truncateText(question, 50)}, PaymentUID=${paymentUID}`);

        // 2. Check if Already Answered
        const answerKey = getAnswerKey(requestContext, AGENT_ADDRESS); // Uses local helper
        const existingAnswer = await getObjectData(answerKey);
        if (existingAnswer) { console.log(`[Agent] Already processed ${requestContext}. Skip.`); return; }

        // 3. Fetch Content
        console.log(`[Agent] Fetching CID: ${jobData.cid}`);
        const content = await fetchContentByCid(jobData.cid);
        if (!content) { throw new Error(`Failed to fetch CID ${jobData.cid}`); }
        const kbContentHash = hashToBigInt(hashData(content));
        console.log(`[Agent] Content fetched. Hash: ${kbContentHash}`);

        // 4. Generate Answer
        console.log("[Agent] Generating answer...");
        const llmAnswer = await generateAnswerFromContent(question, content, requestContext);
        if (!llmAnswer || typeof llmAnswer !== 'string' || llmAnswer.trim().length === 0 || llmAnswer.toLowerCase().startsWith('error')) { throw new Error(`LLM failed: "${llmAnswer}"`); }
        console.log(`[Agent] LLM Answer: ${truncateText(llmAnswer, 80)}`);
        const answerHash = hashToBigInt(hashData(llmAnswer));

        // 5. Generate Proof
        const zkpInputs = { input0: "1", input1: "1", input2: "1", input3: "1", input4: "1", input5: "1", input6: "1", input7: "1" };
        const { proof } = await generateProofForAlwaysTrue(zkpInputs);

        // 6. Prepare Data (Use ethers.constants.HashZero - v5)
        const answerStatementData = { answeringAgent: AGENT_ADDRESS, requestContextRef: requestContext, requestContextHash: 1n, kbContentHash: kbContentHash.toString(), questionHash: 1n, answerHash: answerHash.toString(), llmResponseHash: 1n, answeringAgentId: 111n, claimedVerdict: 1, claimedConfidence: 95, proof_a: proof.a, proof_b: proof.b, proof_c: proof.c, evidenceProposalId: ethers.constants.HashZero, answerCID: "ipfs://placeholderAns", evidenceDataCID: "ipfs://placeholderEvid" };

        // 7. Submit AnswerStatement
        console.log("[Agent] Submitting AnswerStatement TX...");
        const answerTx = await answerStatement.makeStatement( answerStatementData, paymentUID, { gasLimit: AGENT_GAS_LIMIT_ANSWER } );
        console.log(`[Agent] AnswerStatement TX Sent: ${answerTx.hash}. Waiting...`);
        const answerReceipt = await answerTx.wait(1);
        if (answerReceipt.status !== 1) { throw new Error(`AnswerStatement TX failed. Hash: ${answerTx.hash}`); }
        console.log(`[Agent] AnswerStatement TX Confirmed. Block: ${answerReceipt.blockNumber}`);

        // 8. Extract Answer UID (Uses v5 interface)
        answerUID = await findUIDFromReceipt(answerReceipt, ANSWER_STATEMENT_ADDRESS, answerStatement.interface, "AnswerSubmitted", "uid");
        if (!answerUID) { const answerSchemaUID = await answerStatement.ATTESTATION_SCHEMA(); answerUID = await findUIDFromReceipt(answerReceipt, EAS_ADDRESS, eas.interface, "Attested", "uid", answerSchemaUID); }
        if (!answerUID) { throw new Error("CRITICAL: Failed to extract answerUID."); }
        console.log(`[Agent] Extracted answerUID: ${answerUID}`);

        // 9. Submit ZKP Validation
        console.log(`[Agent] Submitting ZKP validation for answerUID: ${answerUID}...`);
        const validateTx = await zkpValidator.validateZKP( answerUID, { gasLimit: AGENT_GAS_LIMIT_VALIDATE } );
        console.log(`[Agent] ZKP Validation TX Sent: ${validateTx.hash}. Waiting...`);
        const validateReceipt = await validateTx.wait(1);
        if (validateReceipt.status !== 1) { throw new Error(`ZKP validation TX failed. Hash: ${validateTx.hash}`); }
        console.log(`[Agent] ZKP Validation TX Confirmed. Block: ${validateReceipt.blockNumber}`);

        // 10. Extract Validation UID (Uses v5 interface)
        validationUID = await findUIDFromReceipt(validateReceipt, ZKPVALIDATOR_ADDRESS, zkpValidator.interface, "ZKPValidationCreated", "validationUID");
         if (!validationUID) { const validatorSchemaUID = await zkpValidator.ATTESTATION_SCHEMA(); validationUID = await findUIDFromReceipt(validateReceipt, EAS_ADDRESS, eas.interface, "Attested", "uid", validatorSchemaUID); }
        if (!validationUID) { throw new Error("CRITICAL: Failed to extract validationUID."); }
        console.log(`[Agent] Extracted validationUID: ${validationUID}`);

        // 11. Log Answer to Recall (Passes both UIDs)
        console.log(`[Agent] Logging answer to Recall. answerUID: ${answerUID}, validationUID: ${validationUID}`);
        const logKey = await logAnswer( llmAnswer, AGENT_ADDRESS, requestContext, answerUID, validationUID );
        if (logKey) { console.log(`[Agent] Successfully logged answer data to Recall. Key: ${logKey}`); }
        else { console.warn(`[Agent] Failed to log answer data to Recall for context ${requestContext}.`); }

        // --- Step 12 COMMENTED OUT ---
        /*
        console.log(`[Agent] Attempting payment collection. PaymentUID: ${paymentUID}, ValidationUID: ${validationUID}...`);
        try {
            const collectTx = await erc20PaymentStatement.collectPayment( paymentUID, validationUID, { gasLimit: AGENT_GAS_LIMIT_COLLECT } );
            console.log(`[Agent] Collect Payment TX Sent: ${collectTx.hash}. Waiting...`);
            const collectReceipt = await collectTx.wait(1);
            if (collectReceipt.status === 1) {
                 console.log(`[Agent] ✅ SUCCESS: Payment collected! Block: ${collectReceipt.blockNumber}`);
                 const paymentInterface = new ethers.utils.Interface(erc20PaymentStatementABI); // v5
                 const collectedAmountRaw = await findUIDFromReceipt(collectReceipt, ERC20_PAYMENT_STATEMENT_ADDRESS, paymentInterface, "PaymentCollected", "amount");
                 if (collectedAmountRaw) { console.log(`[Agent] Collected amount (raw): ${collectedAmountRaw.toString()}`); }
                 await logAgentCollection( requestContext, AGENT_ADDRESS, paymentUID, validationUID, collectTx.hash, collectedAmountRaw );
            } else { console.error(`[Agent] ❌ FAILED: Collect Payment TX reverted. Hash: ${collectTx.hash}.`); }
        } catch (collectError) {
             let errMsg = collectError instanceof Error ? collectError.message : String(collectError);
             if (collectError.error?.message) errMsg = collectError.error.message;
             if (collectError.data?.message) errMsg = collectError.data.message;
             console.error(`[Agent] ❌ FAILED: Error calling collectPayment: ${errMsg}`);
             if (errMsg.includes("Payment already collected") || errMsg.includes("Statement was revoked")) { console.log(`[Agent] Note: Payment likely processed or cancelled.`); }
             else if (errMsg.includes("Invalid fulfillment")) { console.error(`[Agent] Note: Arbiter check failed. Check ZKP logic/UIDs.`); }
        }
        */
        console.log(`[Agent] Answer submitted and ZKP validated. Waiting for backend payout process.`);


        console.log(`[Agent ${AGENT_ADDRESS.substring(0, 10)}] === Finished Processing Job Key: ${jobKey} ===`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[Agent] ---- ERROR processing job ${jobKey} (Context: ${requestContext || 'N/A'}) ----`);
        console.error(`[Agent] Error Message: ${errorMessage}`);
        if (error.receipt) { console.error("[Agent] Failing TX Receipt:", JSON.stringify(error.receipt, null, 2)); }
        else if (error.stack) { console.error(`[Agent] Stack Trace: ${error.stack.substring(0, 600)}...`); }
    }
} // End of processQuestionJob


// --- String Capitalization Job Processing (Using Ethers v5 syntax) ---
async function processStringCapitalizationJobs() {
    if (!STRING_RESULT_STATEMENT_ADDRESS || STRING_RESULT_STATEMENT_ADDRESS === ethers.constants.AddressZero) { return; } // v5
     console.log(`\n[Agent ${AGENT_ADDRESS.substring(0, 10)}] -> processStringCapitalizationJobs | Searching...`);
    try {
        const paymentSchema = await erc20PaymentStatement.ATTESTATION_SCHEMA();
        const easInterface = new ethers.utils.Interface(easABI); // v5
        const attestedEventFilter = eas.filters.Attested(null, null, paymentSchema);
        const fromBlock = process.env.EAS_FROM_BLOCK ? parseInt(process.env.EAS_FROM_BLOCK, 10) : 0;
        console.log(`[Agent String] Querying EAS logs schema ${paymentSchema} from block ${fromBlock}...`);
        // Use provider.getLogs with the filter object for v5
        const eventsRaw = await provider.getLogs({...attestedEventFilter, fromBlock, toBlock: 'latest'});
        // Manually parse logs as getLogs doesn't do it automatically
        const events = eventsRaw.map(log => {
             try { return easInterface.parseLog(log); } catch { return null; }
        }).filter(e => e !== null && e.name === 'Attested'); // Filter out nulls and wrong events

        console.log(`[Agent String] Found ${events.length} potential payment statement attestations`);

        for (const event of events) { // event is now the parsed log
            const paymentUID = event.args.uid;
             try {
                 console.log(`[Agent String] Processing payment UID: ${paymentUID}`);
                 const attestation = await eas.getAttestation(paymentUID);
                 if (attestation.revocationTime !== BigInt(0)) { console.log(`[Agent String] ${paymentUID} revoked.`); continue; }
                 if (attestation.expirationTime !== BigInt(0) && attestation.expirationTime <= BigInt(Math.floor(Date.now() / 1000))) { console.log(`[Agent String] ${paymentUID} expired.`); continue; }

                 let paymentData;
                 try { paymentData = ethers.utils.defaultAbiCoder.decode(["address buyer", "address token", "uint256 amount", "address arbiter", "bytes demand", "bool active"], attestation.data); } // v5
                 catch (decodeError) { console.warn(`[Agent String] Decode fail ${paymentUID}: ${decodeError.message}.`); continue; }

                 if (!paymentData[5]) { console.log(`[Agent String] ${paymentUID} inactive.`); continue; }
                 if (paymentData[3].toLowerCase() !== STRING_RESULT_STATEMENT_ADDRESS.toLowerCase()) { continue; }
                 try { const isUsed = await erc20PaymentStatement.usedStatements(paymentUID); if (isUsed) { console.log(`[Agent String] ${paymentUID} used.`); continue; } }
                 catch (error) { console.warn(`[Agent String] Check used fail ${paymentUID}: ${error.message}.`); continue; }

                 let queryString;
                 try { queryString = ethers.utils.defaultAbiCoder.decode(["string"], paymentData[4])[0]; } // v5
                 catch (demandError) { console.warn(`[Agent String] Demand decode fail ${paymentUID}: ${demandError.message}.`); continue; }
                 console.log(`[Agent String] Job: "${queryString}" for ${paymentUID}`);
                 const result = queryString.toUpperCase();
                 console.log(`[Agent String] Result: "${result}"`);

                 try {
                     console.log(`[Agent String] Submitting result for ${paymentUID}...`);
                     const resultTx = await stringResultStatement.makeStatement( result, paymentUID, { gasLimit: AGENT_GAS_LIMIT_STRING_RESULT } );
                     console.log(`[Agent String] Result TX Sent: ${resultTx.hash}. Waiting...`);
                     const resultReceipt = await resultTx.wait(1);
                     if (resultReceipt.status !== 1) { throw new Error(`StringResult TX fail. Hash: ${resultTx.hash}`); }
                     console.log(`[Agent String] Result TX Confirmed. Block: ${resultReceipt.blockNumber}`);

                     const stringResultSchema = await stringResultStatement.ATTESTATION_SCHEMA();
                     const resultUID = await findUIDFromReceipt(resultReceipt, EAS_ADDRESS, easInterface, "Attested", "uid", stringResultSchema);
                     if (!resultUID) { throw new Error("Failed to extract StringResult UID."); }
                     console.log(`[Agent String] Extracted Result UID: ${resultUID}`);

                     console.log(`[Agent String] Collecting payment ${paymentUID} using result ${resultUID}...`);
                     await new Promise(resolve => setTimeout(resolve, 2000));
                     const collectTx = await erc20PaymentStatement.collectPayment( paymentUID, resultUID, { gasLimit: AGENT_GAS_LIMIT_COLLECT } );
                     console.log(`[Agent String] Collect TX Sent: ${collectTx.hash}. Waiting...`);
                     const collectReceipt = await collectTx.wait(1);
                     if (collectReceipt.status === 1) { console.log(`[Agent String] ✅ SUCCESS: Collected string payment ${paymentUID}!`); }
                     else { console.error(`[Agent String] ❌ FAILED: Collect TX reverted ${paymentUID}. Hash: ${collectTx.hash}`); }
                 } catch (txError) {
                      let errMsg = txError instanceof Error ? txError.message : String(txError);
                      if (txError.error?.message) errMsg = txError.error.message;
                      console.error(`[Agent String] TX error ${paymentUID}: ${errMsg}`);
                  }
            } catch (loopError) {
                  const errorMsg = loopError instanceof Error ? loopError.message : String(loopError);
                  console.warn(`[Agent String] Error processing paymentUID ${paymentUID} in loop: ${errorMsg}`);
            }
        } // End for loop
    } catch (error) {
         const errorMessage = error instanceof Error ? error.message : String(error);
         console.error(`[Agent String] Error processing jobs: ${errorMessage}`);
     }
}


// --- Main Polling Loop ---
async function pollLoop() {
    console.log("\n[Agent] Starting polling loop...");
    // await sendLocalTestEth(); // Called at top level

    try { // Process Recall Jobs
        console.log("[Agent] Checking for Recall jobs...");
        const jobs = await getPendingJobs("reqs/");
        if (jobs?.length > 0) {
            console.log(`[Agent] Found ${jobs.length} Recall jobs.`);
            for (const job of jobs) { await processQuestionJob(job); await new Promise(resolve => setTimeout(resolve, 500)); }
            console.log(`[Agent] Finished batch Recall jobs.`);
        } else { console.log("[Agent] No Recall jobs found."); }
    } catch (error) { const errorMessage = error instanceof Error ? error.message : String(error); console.error("[Agent] Error processing Recall jobs:", errorMessage); }

    try { // Process String Jobs
         await processStringCapitalizationJobs();
    } catch (error) { const errorMessage = error instanceof Error ? error.message : String(error); console.error("[Agent] Error processing String jobs:", errorMessage); }

    if (process.env.CONTINUOUS_POLLING === "true") {
        const pollingInterval = parseInt(process.env.POLLING_INTERVAL || "500000", 10);
        console.log(`[Agent] Continuous polling. Next poll in ${pollingInterval / 1000}s...`);
        setTimeout(pollLoop, pollingInterval);
    } else { console.log("[Agent] One-shot complete. Exiting."); process.exit(0); }
}


// --- Run Agent ---
console.log("[Answering Agent] Starting agent...");
pollLoop().catch((err) => {
    console.error("[Agent] FATAL UNHANDLED ERROR in pollLoop:", err);
    process.exit(1);
});