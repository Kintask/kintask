// ROOT/scripts/agents/answeringAgent.js (Programmatic KB Registration + ZKP + Log Evidence)

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { privateKeyToAccount } from 'viem/accounts';
import { getAddress } from 'viem';
import { ethers } from 'ethers';
import * as snarkjs from "snarkjs";

// --- Import Utilities ---
import {
  createEvidenceCar,
  uploadCarFile,
  makeOffChainDeal,
  truncateText,
  hashData,
  hashToBigInt
} from './agentUtils.js';

// --- Environment Variable Loading ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../../packages/backend/.env');
dotenv.config({ path: envPath });
console.log(`[Answering Agent EvLog] Loading .env from backend: ${envPath}`);

// --- Configuration Flags ---
const IS_LOCAL_TEST = !!process.env.LOCALHOST_RPC_URL;
const USE_HARDCODED_LLM = process.env.USE_HARDCODED_LLM === 'true';
console.log(`[Answering Agent EvLog] Running in ${IS_LOCAL_TEST ? 'LOCAL' : 'CALIBRATION'} mode.`);
if (USE_HARDCODED_LLM) console.log("[Answering Agent EvLog] USING HARDCODED LLM RESPONSES.");

// --- Agent Identity (Always derived from AGENT_PRIVATE_KEY) ---
let AGENT_ID, AGENT_ADDRESS, AGENT_PRIVATE_KEY;
try {
    AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || process.env.RECALL_PRIVATE_KEY;
    if (!AGENT_PRIVATE_KEY) throw new Error('AGENT_PRIVATE_KEY or RECALL_PRIVATE_KEY must be set');
    const formattedPrivateKey = AGENT_PRIVATE_KEY.startsWith('0x') ? AGENT_PRIVATE_KEY : `0x${AGENT_PRIVATE_KEY}`;
    const viemAccount = privateKeyToAccount(formattedPrivateKey);
    AGENT_ADDRESS = getAddress(viemAccount.address);
    AGENT_ID = AGENT_ADDRESS; // Use actual agent address as ID
    console.log(`[Answering Agent EvLog] Agent Address (for ZKP Input): ${AGENT_ADDRESS}`);
} catch (error) { console.error("[Answering Agent EvLog] FATAL: Derive agent ID failed.", error); process.exit(1); }

// --- Owner Identity (Needed for KB Reg) ---
let OWNER_ADDRESS, OWNER_PRIVATE_KEY;
try {
    OWNER_PRIVATE_KEY = (IS_LOCAL_TEST && process.env.LOCALHOST_OWNER_PRIVATE_KEY)
         ? process.env.LOCALHOST_OWNER_PRIVATE_KEY
         : (process.env.WALLET_PRIVATE_KEY || process.env.RECALL_PRIVATE_KEY);
    if (!OWNER_PRIVATE_KEY) throw new Error('Owner Key (LOCALHOST_OWNER_PRIVATE_KEY or WALLET/RECALL_PRIVATE_KEY) missing');
    const formattedOwnerKey = OWNER_PRIVATE_KEY.startsWith('0x') ? OWNER_PRIVATE_KEY : `0x${OWNER_PRIVATE_KEY}`;
    const ownerAccount = privateKeyToAccount(formattedOwnerKey);
    OWNER_ADDRESS = getAddress(ownerAccount.address);
    console.log(`[Answering Agent EvLog] Owner Address for KB Reg: ${OWNER_ADDRESS}`);
} catch (error) { console.error("[Answering Agent EvLog] FATAL: Derive owner address failed.", error); process.exit(1); }


// --- ZKP Configuration ---
const ZKP_CIRCUIT_WASM_PATH = path.resolve(__dirname, "../../packages/contracts/circuits/evaluator/build/evaluator_js/evaluator.wasm");
const ZKP_CIRCUIT_ZKEY_PATH = path.resolve(__dirname, "../../packages/contracts/circuits/evaluator/build/evaluator_final.zkey");

// --- Service Imports ---
const servicesBasePath = path.resolve(__dirname, '../../packages/backend/dist/services');
const recallServicePath = path.join(servicesBasePath, 'recallService.js');
const filecoinServicePath = path.join(servicesBasePath, 'filecoinService.js');
const generatorServicePath = path.join(servicesBasePath, 'generatorService.js');
// *** Import logAnswerEvidence ***
let getPendingJobs, getObjectData, addObjectToBucket, logAnswerEvidence;
let fetchContentByCid;
let generateAnswerFromContent, evaluateAnswerWithLLM;
try {
    console.log(`[Answering Agent EvLog] Importing services...`);
    const recallService = await import(pathToFileURL(recallServicePath).href);
    ({ getPendingJobs, getObjectData, addObjectToBucket, logAnswerEvidence } = recallService.default || recallService); // Added logAnswerEvidence
    const filecoinService = await import(pathToFileURL(filecoinServicePath).href);
    ({ fetchContentByCid } = filecoinService.default || filecoinService);
    // Check base functions + evidence function
    if (!getPendingJobs || !getObjectData || !addObjectToBucket || !logAnswerEvidence || !fetchContentByCid) {
        throw new Error("Base/Evidence service import failed.");
    }
    if (!USE_HARDCODED_LLM) {
        console.log(`[Answering Agent EvLog] Importing generator service...`);
        const generatorServiceModule = await import(pathToFileURL(generatorServicePath).href);
        generateAnswerFromContent = generatorServiceModule.generateAnswerFromContent || generatorServiceModule.default?.generateAnswerFromContent;
        evaluateAnswerWithLLM = generatorServiceModule.evaluateAnswerWithLLM || generatorServiceModule.default?.evaluateAnswerWithLLM;
        if (!generateAnswerFromContent || !evaluateAnswerWithLLM) { throw new Error("Generator import failed."); }
        console.log('[Answering Agent EvLog] Generator services imported.');
    } else { console.log('[Answering Agent EvLog] Skipping generator import.'); }
    console.log('[Answering Agent EvLog] Required services initialized.');
} catch (importError) { console.error("[Answering Agent EvLog] FATAL: Service initialization failed.", importError); process.exit(1); }

// --- Contract Setup ---
const AGGREGATOR_CONTRACT_ADDRESS = IS_LOCAL_TEST ? process.env.LOCALHOST_ZKP_AGGREGATOR_ADDRESS : process.env.ZKP_AGGREGATOR_CONTRACT_ADDRESS;
let provider, agentWallet, ownerWallet, aggregatorContractAgent, aggregatorContractOwner, contractAbi;
if (!AGGREGATOR_CONTRACT_ADDRESS || !OWNER_PRIVATE_KEY) { console.error(`FATAL: Contract Address or Owner Key missing.`); process.exit(1); }
try {
    const rpcUrl = IS_LOCAL_TEST ? process.env.LOCALHOST_RPC_URL : (process.env.L2_RPC_URL || process.env.FVM_RPC_URL); if (!rpcUrl) throw new Error(`RPC URL not found.`);
    provider = new ethers.providers.StaticJsonRpcProvider(rpcUrl);

    let agentSigningKey; let expectedAgentSignerAddress;
    if (IS_LOCAL_TEST) { agentSigningKey = process.env.LOCALHOST_OWNER_PRIVATE_KEY; if (!agentSigningKey) throw new Error('LOCALHOST_OWNER_PRIVATE_KEY missing'); expectedAgentSignerAddress = OWNER_ADDRESS; console.log("[Answering Agent EvLog] LOCAL MODE: Agent sign with LOCALHOST_OWNER_PRIVATE_KEY."); }
    else { agentSigningKey = AGENT_PRIVATE_KEY; expectedAgentSignerAddress = AGENT_ADDRESS; console.log("[Answering Agent EvLog] CALIBRATION MODE: Agent sign with AGENT_PRIVATE_KEY."); }
    agentWallet = new ethers.Wallet(agentSigningKey, provider); if (getAddress(agentWallet.address) !== expectedAgentSignerAddress) { console.error(`FATAL: Agent signing Wallet mismatch. Ethers: ${agentWallet.address}, Expected: ${expectedAgentSignerAddress}.`); process.exit(1); }
    ownerWallet = new ethers.Wallet(OWNER_PRIVATE_KEY, provider); if (getAddress(ownerWallet.address) !== OWNER_ADDRESS) { console.error(`FATAL: Owner Wallet mismatch.`); process.exit(1); }

    const abiPath = path.resolve(__dirname, "../../packages/contracts/artifacts/contracts/ZKPEvaluatorAggregator.sol/ZKPEvaluatorAggregator.json"); if (!fs.existsSync(abiPath)) throw new Error(`ABI file not found: ${abiPath}`); const abiJsonString = fs.readFileSync(abiPath, 'utf8'); const contractAbiJson = JSON.parse(abiJsonString); contractAbi = contractAbiJson.abi; if (!contractAbi || contractAbi.length === 0) throw new Error("ABI load failed.");
    aggregatorContractAgent = new ethers.Contract(AGGREGATOR_CONTRACT_ADDRESS, contractAbi, agentWallet);
    aggregatorContractOwner = new ethers.Contract(AGGREGATOR_CONTRACT_ADDRESS, contractAbi, ownerWallet);

    console.log(`[Answering Agent EvLog] Agent ID Addr: ${AGENT_ADDRESS}`); console.log(`[Answering Agent EvLog] Tx Signing Wallet: ${agentWallet.address}`); console.log(`[Answering Agent EvLog] Owner Wallet (KB Reg): ${ownerWallet.address}`); console.log(`[Answering Agent EvLog] RPC: ${rpcUrl}`); console.log(`[Answering Agent EvLog] Contract: ${AGGREGATOR_CONTRACT_ADDRESS}`);
} catch (err) { console.error("FATAL: Failed init ethers/ABI:", err); process.exit(1); }


// --- Agent Configuration & State ---
const POLLING_INTERVAL_MS = 15000; const CONTEXT_DATA_PREFIX = "reqs/"; let isShuttingDown = false; let pollingTimeoutId = null;
console.log(`[Answering Agent EvLog] Starting Polling | Agent ID (logs): ${AGENT_ID.substring(0, 10)}...`);

// --- Hardcoded Data ---
const HARDCODED_ANSWER = "This is the hardcoded answer."; const HARDCODED_EVALUATION_RESULT = { evaluation: 'Correct', confidence: 0.95, explanation: "Hardcoded evaluation." }; const PLACEHOLDER_DEAL_ID = BigInt(999999999);

// --- Helper Functions ---
async function logAgentAnswer(answer, agentId, requestContext) { const key = `${CONTEXT_DATA_PREFIX}${requestContext}/answers/${agentId}.json`; const data = { answer, answeringAgentId: agentId, status: 'Submitted', timestamp: new Date().toISOString(), requestContext }; const result = await addObjectToBucket(data, key); console.log(`[Recall] Logged Answer | Ctx: ${requestContext.substring(0,6)} | Agt: ${agentId.substring(0,10)} | OK: ${result.success} | Existed: ${result.keyExists}`); return result.success ? key : undefined; }
async function generateProof(inputs) { console.log("[Answering Agent EvLog] Generating ZKP proof..."); try { const { proof, publicSignals } = await snarkjs.groth16.fullProve(inputs, ZKP_CIRCUIT_WASM_PATH, ZKP_CIRCUIT_ZKEY_PATH); console.log("[Answering Agent EvLog] ZKP Proof generated successfully."); const formattedProof = { a: [proof.pi_a[0], proof.pi_a[1]], b: [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]], c: [proof.pi_c[0], proof.pi_c[1]] }; const formattedPublicSignals = publicSignals.map(ps => BigInt(ps).toString()); return { proof: formattedProof, publicSignals: formattedPublicSignals }; } catch (err) { console.error("[Answering Agent EvLog] Error generating ZKP proof:", err); return null; } }
async function submitEvaluationToContract(requestContext, proof, publicSignals, dealId) { console.log(`[Answering Agent EvLog] Submitting evaluation & Deal ID ${dealId} to contract ctx ${requestContext}...`); try { const tx = await aggregatorContractAgent.submitVerifiedEvaluation( requestContext, AGENT_ADDRESS, proof.a, proof.b, proof.c, publicSignals, dealId, { gasLimit: 20000000 }); console.log(`[Answering Agent EvLog] Tx sent: ${tx.hash}`); const receipt = await tx.wait(); console.log(`[Answering Agent EvLog] Tx confirmed: Blk ${receipt.blockNumber}, Gas: ${receipt.gasUsed.toString()}`); const eventName = "EvaluationVerified"; const verifiedEvent = receipt.events?.find(e => e.event === eventName); if (verifiedEvent) { console.log(`[Answering Agent EvLog] Contract emitted ${eventName}. SUCCESS!`); return { success: true, txHash: tx.hash }; } else { const failedEvent = receipt.events?.find(e => e.event === "EvaluationFailed"); if (failedEvent) { const reason = failedEvent.args?.reason || "Unknown"; console.error(`Contract emitted EvaluationFailed: ${reason}`); return { success: false, error: `Contract verification failed: ${reason}`, txHash: tx.hash }; } else { if (receipt.status === 0) { console.error(`Tx reverted (Status 0). Tx: ${tx.hash}`); return { success: false, error: "Transaction reverted", txHash: tx.hash }; } console.error(`Tx confirmed (Status ${receipt.status}), but event not found.`); return { success: false, error: "Contract status unclear.", txHash: tx.hash }; } } } catch (error) { const reason = error.reason || error.error?.reason || error.message || String(error); console.error(`[Answering Agent EvLog] Error submitting:`, reason); if(error.transactionHash) console.error(`  Failing Transaction: ${error.transactionHash}`); return { success: false, error: reason }; } }
async function ensureKBRegistered(requestContext, expectedKbHash) { const shortCtx = requestContext.substring(0, 10); console.log(`[Agent ${AGENT_ID.substring(0, 10)}...] Ensure KB Registered | Ctx: ${shortCtx} | Hash: ${expectedKbHash.substring(0,12)}...`); try { const kbInfo = await aggregatorContractOwner.kbFilings(requestContext); if (kbInfo && kbInfo.registered === true) { if (kbInfo.contentHash?.toLowerCase() === expectedKbHash.toLowerCase()) { console.log(`[Agent ${AGENT_ID.substring(0, 10)}...] KB already registered correctly | Ctx: ${shortCtx}`); return true; } else { console.error(`[Agent ${AGENT_ID.substring(0, 10)}...] FATAL: KB HASH MISMATCH for Ctx: ${shortCtx}.`); return false; } } else { console.log(`[Agent ${AGENT_ID.substring(0, 10)}...] KB not registered Ctx: ${shortCtx}. Attempting registration...`); const tx = await aggregatorContractOwner.registerKnowledgeBase(requestContext, expectedKbHash); console.log(`[Agent ${AGENT_ID.substring(0, 10)}...] KB Reg Tx Sent: ${tx.hash} | Ctx: ${shortCtx}`); const receipt = await tx.wait(); if (receipt.status === 1) { console.log(`[Agent ${AGENT_ID.substring(0, 10)}...] KB Reg Confirmed | Ctx: ${shortCtx}`); return true; } else { console.error(`[Agent ${AGENT_ID.substring(0, 10)}...] KB Reg Tx FAILED | Ctx: ${shortCtx}`); return false; } } } catch (error) { const reason = error.reason || error.message || String(error); console.error(`[Agent ${AGENT_ID.substring(0, 10)}...] Error KB reg check/attempt | Ctx: ${shortCtx}:`, reason); return false; } }


// --- Process Job Function ---
async function processQuestionJob(jobInfo) {
  const jobKey = jobInfo.key;
  console.log(`\n[Agent ${AGENT_ID.substring(0, 10)}...] ==> ENTER processQuestionJob | Key: ${jobKey}`);
  let jobData = null; let requestContext = 'unknownContext'; let answer = ''; let evaluationResult = null; let kbContentHash; let answerLogKey;

  try {
    // 1. Fetch Job Data & Context
    jobData = jobInfo.data || await getObjectData(jobKey); if (!jobData?.question || !jobData?.cid || !jobData?.requestContext) { console.warn(`Invalid job data ${jobKey}. Skip.`); return; } requestContext = jobData.requestContext; console.log(`Processing Ctx: ${requestContext}`);

    // 2. Fetch Content & Calculate Hash
    console.log(`Fetching KB content | CID: ${jobData.cid.substring(0, 10)}...`); const content = await fetchContentByCid(jobData.cid); if (!content) { throw new Error(`Failed fetch KB CID ${jobData.cid}.`); } console.log(`Fetched KB (Len: ${content.length})`); kbContentHash = hashToBigInt(hashData(content)); const expectedKbHashHex = ethers.utils.hexlify(kbContentHash); console.log(`Calculated KB Hash: ${expectedKbHashHex}`);

    // 3. Ensure KB is Registered
    const registrationSuccess = await ensureKBRegistered(requestContext, expectedKbHashHex); if (!registrationSuccess) { throw new Error(`Failed KB registration Ctx: ${requestContext}.`); }

    // 4. Check On-Chain Verification Status
    let existingRecord; try { console.log(`Check existing verification: Ctx ${requestContext}`); existingRecord = await aggregatorContractAgent.getVerifiedEvaluation(requestContext, AGENT_ADDRESS); console.log(`On-chain record: verified = ${existingRecord?.verified}`); } catch (e) { console.error(`ERROR getVerifiedEvaluation Ctx ${requestContext}:`, e); return; } if (existingRecord?.verified === true) { console.log(`Already verified Ctx ${requestContext}. Skip.`); return; }

    // 5. Generate/Use Answer
    if (USE_HARDCODED_LLM) { answer = HARDCODED_ANSWER; console.log(`Using hardcoded answer: "${truncateText(answer, 60)}"`); } else { console.log(`Generating answer via LLM...`); answer = await generateAnswerFromContent(jobData.question, content, requestContext); if (typeof answer !== 'string' || answer.startsWith('Error:')) { console.error(`Answer generation FAILED: ${answer}`); return; } console.log(`LLM Answer: "${truncateText(answer, 60)}"`); }

    // 6. Log Answer to Recall
    answerLogKey = await logAgentAnswer(answer, AGENT_ID, requestContext); // Store key

    // 7. Evaluate/Use Evaluation
    if (USE_HARDCODED_LLM) { evaluationResult = HARDCODED_EVALUATION_RESULT; console.log(`Using hardcoded eval: ${evaluationResult.evaluation} (Conf: ${evaluationResult.confidence})`); } else { console.log(`Evaluating answer via LLM...`); const kbExcerpt = content.substring(0, 3500); evaluationResult = await evaluateAnswerWithLLM(jobData.question, answer, kbExcerpt, requestContext, AGENT_ID); if (!evaluationResult?.explanation) { throw new Error(`Failed LLM evaluation.`); } console.log(`LLM Evaluated: ${evaluationResult.evaluation} (Conf: ${evaluationResult.confidence})`); }
    const rawLLMResponseForHash = evaluationResult.explanation || "";

    // 8. Prepare ZKP Inputs
    console.log(`Preparing ZKP inputs...`); const requestContextHash = hashToBigInt(hashData(requestContext)); const questionHash = hashToBigInt(hashData(jobData.question)); const answerHash = hashToBigInt(hashData(answer)); const llmResponseHash = hashToBigInt(hashData(rawLLMResponseForHash)); const answeringAgentIdBigInt = BigInt(AGENT_ADDRESS); const verdictMap = { 'Incorrect': 0, 'Correct': 1, 'Uncertain': 2 }; const claimedVerdict = BigInt(verdictMap[evaluationResult.evaluation] ?? 2); const claimedConfidence = BigInt(Math.round(evaluationResult.confidence * 100)); const parsedVerdictCode = claimedVerdict; const parsedConfidenceScaled = claimedConfidence; if (kbContentHash === undefined) { throw new Error("kbContentHash undefined."); } const circuitInputs = { requestContextHash: requestContextHash.toString(), kbContentHash: kbContentHash.toString(), questionHash: questionHash.toString(), answerHash: answerHash.toString(), llmResponseHash: llmResponseHash.toString(), answeringAgentId: answeringAgentIdBigInt.toString(), evaluationVerdict: claimedVerdict, evaluationConfidence: claimedConfidence, parsedVerdictCode: parsedVerdictCode, parsedConfidenceScaled: parsedConfidenceScaled }; console.log(`  Agent Address for ZKP Input [5]: ${AGENT_ADDRESS} -> ${answeringAgentIdBigInt.toString()}`);

    // 9. Generate ZKP
    const proofData = await generateProof(circuitInputs); if (!proofData) { throw new Error(`Failed ZKP generation.`); }

    // 10. Create Evidence Package & CAR File
    console.log(`Creating evidence package & CAR file...`); const evidencePackage = { requestContext, question: jobData.question, knowledgeBaseCid: jobData.cid, answer, evaluation: evaluationResult, agentId: AGENT_ID, agentAddress: AGENT_ADDRESS, timestamp: new Date().toISOString(), zkpPublicInputs: proofData.publicSignals }; let carInfo; try { carInfo = await createEvidenceCar(evidencePackage, `evidence-${requestContext}.json`); console.log(`Evidence CAR generated: DataCID=${carInfo.dataCid}, PieceCID=${carInfo.pieceCid} (Simulated), Size=${carInfo.carSize}`); } catch (carError) { const errorMsg = carError instanceof Error ? carError.message : String(carError); throw new Error(`Failed CAR creation: ${errorMsg}`); }

    // 11. Use Placeholder Deal ID
    const placeholderDealId = PLACEHOLDER_DEAL_ID; console.log(`Using placeholder Deal ID: ${placeholderDealId}`);

    // 12. Submit Evaluation & Placeholder Deal Info to Contract
    const submissionResult = await submitEvaluationToContract(requestContext, proofData.proof, proofData.publicSignals, placeholderDealId); if (!submissionResult.success) { throw new Error(`Contract submission failed: ${submissionResult.error}`); }

    // *** 13. Log Evidence Metadata to Recall ***
    console.log(`Attempting to log answer evidence metadata to Recall...`);
    const evidenceMetadata = {
        requestContext: requestContext,
        answeringAgentId: AGENT_ID,
        answerKey: answerLogKey || `UNKNOWN_ANSWER_KEY_${Date.now()}`, // Use logged key
        evidenceDataCid: carInfo.dataCid,
        evidenceCarSize: carInfo.carSize,
        evidencePieceCid: carInfo.pieceCid, // Simulated
        evidencePieceSize: carInfo.pieceSize, // Simulated
        // evidenceCarUrl: carUrl, // Add when upload is implemented
        submittedDealId: placeholderDealId,
        submissionTxHash: submissionResult.txHash, // Log the successful TX hash
        timestamp: new Date().toISOString()
    };
    // Call the imported logAnswerEvidence function
    if (typeof logAnswerEvidence === 'function') {
        await logAnswerEvidence(evidenceMetadata); // No need to await if background logging is ok
    } else {
        console.warn("logAnswerEvidence function not found in recallService, skipping evidence log.");
    }
    // *** End Evidence Logging ***

    console.log(`Finished job ${jobKey} successfully. Tx: ${submissionResult.txHash}`);

  } catch (error) { const errorMessage = error instanceof Error ? error.message : String(error); console.error(`[Agent ${AGENT_ID.substring(0, 10)}...] Error processing job ${jobKey}: ${errorMessage}`); }
  finally { console.log(`[Agent ${AGENT_ID.substring(0, 10)}...] <== EXIT processQuestionJob | Key: ${jobKey}`); }
}

// --- Polling Loop ---
async function pollLoop() { /* ... no change ... */ if (isShuttingDown) { console.log(`[Agent ${AGENT_ID.substring(0, 10)}...] Shutdown. Stop poll.`); return; } try { console.log(`[Agent ${AGENT_ID.substring(0, 10)}...] Polling Recall prefix: ${CONTEXT_DATA_PREFIX}`); const pendingJobs = await getPendingJobs(CONTEXT_DATA_PREFIX); if (pendingJobs && Array.isArray(pendingJobs) && pendingJobs.length > 0) { console.log(`[Agent ${AGENT_ID.substring(0, 10)}...] Found ${pendingJobs.length} potential job keys.`); for (const jobInfo of pendingJobs) { if (isShuttingDown) break; if (jobInfo?.key) { await processQuestionJob(jobInfo); } else { console.warn(`[Agent ${AGENT_ID.substring(0, 10)}...] Invalid job info item:`, jobInfo); } } console.log(`[Agent ${AGENT_ID.substring(0, 10)}...] Finished processing batch.`); } else { console.log(`[Agent ${AGENT_ID.substring(0, 10)}...] No pending question jobs found.`); } } catch (error) { const errorMsg = error instanceof Error ? error.message : String(error); console.error(`[Agent ${AGENT_ID.substring(0, 10)}...] Poll loop error:`, errorMsg); } finally { if (!isShuttingDown) { pollingTimeoutId = setTimeout(pollLoop, POLLING_INTERVAL_MS); } } }

// --- Start/Stop Logic ---
function startAgent() { pollLoop(); }
function shutdownAgent() { /* ... no change ... */ if (isShuttingDown) return; console.log(`\n[Agent ${AGENT_ID.substring(0, 10)}...] Shutdown signal...`); isShuttingDown = true; if (pollingTimeoutId) { clearTimeout(pollingTimeoutId); console.log(`[Agent ${AGENT_ID.substring(0, 10)}...] Polling stopped.`); } setTimeout(() => { console.log(`[Agent ${AGENT_ID.substring(0, 10)}...] Exiting.`); process.exit(0); }, 1000); }
process.on('SIGTERM', shutdownAgent); process.on('SIGINT', shutdownAgent);

// --- Run Agent ---
if (aggregatorContractAgent && typeof aggregatorContractAgent.submitVerifiedEvaluation === 'function') { startAgent(); }
else { console.error("FATAL: Contract instance invalid. Agent cannot start."); process.exit(1); }