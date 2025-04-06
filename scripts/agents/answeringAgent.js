// ROOT/scripts/agents/answeringAgent.js (Consensus Version + Public Key ID)

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
// Import viem utilities needed for key derivation
import { privateKeyToAccount } from 'viem/accounts';
import { getAddress } from 'viem'; // To ensure checksum format

// --- .env path resolution ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../../packages/backend/.env');
dotenv.config({ path: envPath });
console.log(`[Answering Agent ESM - Consensus PKID] Loading .env from backend: ${envPath}`);

// --- Derive Agent ID from Private Key ---
let AGENT_ID;
let AGENT_ADDRESS;
try {
    const privateKey = process.env.RECALL_PRIVATE_KEY;
    if (!privateKey) {
        throw new Error('RECALL_PRIVATE_KEY is missing in the .env file.');
    }
    const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const account = privateKeyToAccount(formattedPrivateKey);
    AGENT_ADDRESS = getAddress(account.address); // Get checksummed address
    // Use the address directly or a truncated version as the ID for filenames
    // Using the full address ensures uniqueness but makes filenames long
    AGENT_ID = AGENT_ADDRESS;
    // Alternatively, use a prefix + truncated address:
    // AGENT_ID = `agent_${AGENT_ADDRESS.substring(0, 6)}...${AGENT_ADDRESS.substring(AGENT_ADDRESS.length - 4)}`;
    console.log(`[Answering Agent ESM - Consensus PKID] Derived Agent Address: ${AGENT_ADDRESS}`);
    console.log(`[Answering Agent ESM - Consensus PKID] Using Agent ID: ${AGENT_ID}`);
} catch (error) {
    console.error("[Answering Agent ESM - Consensus PKID] FATAL: Could not derive agent ID from private key.", error);
    process.exit(1);
}


// --- Import necessary services ---
const servicesBasePath = path.resolve(__dirname, '../../packages/backend/dist/services');
const recallServicePath = path.join(servicesBasePath, 'recallService.js');
const filecoinServicePath = path.join(servicesBasePath, 'filecoinService.js');
const generatorServicePath = path.join(servicesBasePath, 'generatorService.js');

let recallService, filecoinService, generatorServiceModule;
let getPendingJobs, getObjectData, logErrorEvent, addObjectToBucket;
let fetchContentByCid;
let generateAnswerFromContent;

try {
    console.log(`[Answering Agent ESM - Consensus PKID] Importing services...`);
    recallService = await import(pathToFileURL(recallServicePath).href);
    ({ getPendingJobs, getObjectData, logErrorEvent, addObjectToBucket } = recallService.default || recallService);

    filecoinService = await import(pathToFileURL(filecoinServicePath).href);
    ({ fetchContentByCid } = filecoinService.default || filecoinService);

    generatorServiceModule = await import(pathToFileURL(generatorServicePath).href);
    generateAnswerFromContent = generatorServiceModule.generateAnswerFromContent || generatorServiceModule.default?.generateAnswerFromContent;

    // --- Validate Imports ---
    if (typeof getPendingJobs !== 'function') throw new Error('Failed to import getPendingJobs');
    // ... other validations ...
    if (typeof generateAnswerFromContent !== 'function') { throw new Error(`Failed to find 'generateAnswerFromContent'`); }
    console.log('[Answering Agent ESM - Consensus PKID] All service functions imported successfully.');

} catch (importError) {
    console.error("[Answering Agent ESM - Consensus PKID] FATAL: Failed to import required services.", importError);
    process.exit(1);
}


// --- Agent Configuration ---
const POLLING_INTERVAL_MS = 15000;
const QUESTIONS_RECALL_PREFIX = "questions/";
const ANSWERS_RECALL_PREFIX = "answers/";

let isShuttingDown = false;
let pollingTimeoutId = null;

console.log(`[Answering Agent ESM - Consensus PKID] Starting Polling | ID: ${AGENT_ID}`);

// --- Helper function ---
function truncateText(text, maxLength) { /* ... keep implementation ... */ }

/**
 * Logs this agent's specific answer to Recall using the derived AGENT_ID.
 */
async function logAgentAnswer(answer, agentId, requestContext) {
     const key = `${ANSWERS_RECALL_PREFIX}${requestContext}/${agentId}.json`; // Use persistent agentId
     const data = { answer, answeringAgentId: agentId, status: 'Submitted', timestamp: new Date().toISOString(), requestContext };
     const result = await addObjectToBucket(data, key);
     console.log(`[Recall Service via Agent] Logged Agent Answer | Context: ${requestContext.substring(0,10)} | Agent: ${agentId.substring(0,10)}... | Key: ${key} | Success: ${result.success} | Error: ${result.error || 'None'}`);
     return result.success ? key : undefined;
}


// --- Process Job Function for Consensus ---
async function processQuestionJob(jobKey) {
    console.log(`[Answering Agent ESM - Consensus PKID ${AGENT_ID.substring(0,10)}...] Checking job | Key: ${jobKey}`);
    let jobData = null;
    let requestContext = 'unknownContext';

    try {
        // 1. Fetch Job Data
        jobData = await getObjectData(jobKey);
        if (!jobData) { console.warn(`[Answering Agent ESM - Consensus PKID ${AGENT_ID.substring(0,10)}...] Job data not found for key ${jobKey}. Skipping.`); return; }
        if (typeof jobData !== 'object' || jobData === null) { throw new Error(`Invalid job data type`); }
        if (!jobData.question || !jobData.cid || !jobData.requestContext) { throw new Error(`Job data missing required fields.`); }
        requestContext = jobData.requestContext;

        // 2. Check if THIS agent (identified by persistent AGENT_ID) already answered
        const ownAnswerKey = `${ANSWERS_RECALL_PREFIX}${requestContext}/${AGENT_ID}.json`; // Use persistent ID
        const ownExistingAnswer = await getObjectData(ownAnswerKey);
        if (ownExistingAnswer) {
            console.log(`[Answering Agent ESM - Consensus PKID ${AGENT_ID.substring(0,10)}...] Agent already processed context ${requestContext}. Skipping job ${jobKey}.`);
            return; // Skip processing
        }

        console.log(`[Answering Agent ESM - Consensus PKID ${AGENT_ID.substring(0,10)}...] Processing NEW job | Key: ${jobKey} | Context: ${requestContext}`);

        // 3. Fetch Content
        console.log(`[Answering Agent ESM - Consensus PKID ${AGENT_ID.substring(0,10)}...] Fetching content | CID: ${jobData.cid.substring(0, 10)}... | Context: ${requestContext}`);
        const content = await fetchContentByCid(jobData.cid);
        if (!content) { throw new Error(`Failed to fetch content for CID ${jobData.cid}.`); }
        console.log(`[Answering Agent ESM - Consensus PKID ${AGENT_ID.substring(0,10)}...] Content fetched (Length: ${content.length}) | Context: ${requestContext}`);

        // 4. Generate Answer
        console.log(`[Answering Agent ESM - Consensus PKID ${AGENT_ID.substring(0,10)}...] Generating answer... | Context: ${requestContext}`);
        const answer = await generateAnswerFromContent(jobData.question, content, requestContext);
        if (typeof answer !== 'string' || answer.startsWith('Error:')) { throw new Error(`LLM failed to generate answer: ${answer || 'Empty response'}`); }
        console.log(`[Answering Agent ESM - Consensus PKID ${AGENT_ID.substring(0,10)}...] Answer generated: "${truncateText(answer, 100)}" | Context: ${requestContext}`);

        // 5. Log THIS Agent's Answer to Recall (uses persistent AGENT_ID)
        console.log(`[Answering Agent ESM - Consensus PKID ${AGENT_ID.substring(0,10)}...] Attempting logAgentAnswer -> addObjectToBucket... | Context: ${requestContext}`);
        const answerKey = await logAgentAnswer(answer, AGENT_ID, requestContext);
        if (!answerKey) {
             console.error(`[Answering Agent ESM - Consensus PKID ${AGENT_ID.substring(0,10)}...] CRITICAL: Failed to log agent answer for context ${requestContext}. Job ${jobKey} processing incomplete.`);
             return;
        } else {
            console.log(`[Answering Agent ESM - Consensus PKID ${AGENT_ID.substring(0,10)}...] Agent answer logged successfully | Key: ${answerKey} | Context: ${requestContext}`);
        }

        // --- DO NOT DELETE THE ORIGINAL QUESTION JOB ---
        console.log(`[Answering Agent ESM - Consensus PKID ${AGENT_ID.substring(0,10)}...] Finished processing job ${jobKey} (original question NOT deleted) | Context: ${requestContext}`);

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[Answering Agent ESM - Consensus PKID ${AGENT_ID.substring(0,10)}...] Error processing job ${jobKey}: ${errorMessage}`);
        try {
            await logErrorEvent({ stage: 'AnsweringAgentConsensusProcessJob', error: errorMessage, originalJobKey: jobKey, agentId: AGENT_ID }, requestContext );
        } catch (logError) {
            console.error(`[Answering Agent ESM - Consensus PKID ${AGENT_ID.substring(0,10)}...] FAILED to log processing error for context ${requestContext}. Error: ${logError.message}`);
        }
    }
}

// --- Polling Loop ---
async function pollLoop() {
    if (isShuttingDown) { console.log(`[Answering Agent ESM - Consensus PKID ${AGENT_ID.substring(0,10)}...] Shutdown signal received. Stopping polling.`); return; }
    try {
        const pendingJobs = await getPendingJobs(QUESTIONS_RECALL_PREFIX);
        if (pendingJobs.length > 0) {
            console.log(`[Answering Agent ESM - Consensus PKID ${AGENT_ID.substring(0,10)}...] Found ${pendingJobs.length} potential question jobs to check.`);
            for (const jobInfo of pendingJobs) {
                if (isShuttingDown) break;
                if (jobInfo && jobInfo.key) { await processQuestionJob(jobInfo.key); }
                else { console.warn(`[Answering Agent ESM - Consensus PKID ${AGENT_ID.substring(0,10)}...] Received invalid job info during poll:`, jobInfo); }
            }
        }
    } catch (error) { console.error(`[Answering Agent ESM - Consensus PKID ${AGENT_ID.substring(0,10)}...] Error during polling loop:`, error.message || error); }
    finally {
        if (!isShuttingDown) { pollingTimeoutId = setTimeout(pollLoop, POLLING_INTERVAL_MS); }
    }
}

// --- Start/Stop Logic ---
function startAgent() { pollLoop(); }
function shutdownAgent() {
    if (isShuttingDown) return;
    console.log(`\n[Answering Agent ESM - Consensus PKID ${AGENT_ID.substring(0,10)}...] Shutdown signal received...`);
    isShuttingDown = true;
    if (pollingTimeoutId) { clearTimeout(pollingTimeoutId); console.log(`[Answering Agent ESM - Consensus PKID ${AGENT_ID.substring(0,10)}...] Polling stopped.`); }
    setTimeout(() => { console.log(`[Answering Agent ESM - Consensus PKID ${AGENT_ID.substring(0,10)}...] Exiting.`); process.exit(0); }, 5000);
}

process.on('SIGTERM', shutdownAgent);
process.on('SIGINT', shutdownAgent);

startAgent();

// ==== ./scripts/agents/answeringAgent.js (Consensus Version + Public Key ID) ====