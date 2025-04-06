// ROOT/scripts/agents/answeringAgent.js (ESM Version - Consensus)

import dotenv from 'dotenv'; // Static import should work if dotenv supports ESM or project handles interop
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url'; // Needed for __dirname and dynamic imports

// --- Correct .env path resolution ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Load .env from packages/backend relative to this script in scripts/agents
const envPath = path.resolve(__dirname, '../../packages/backend/.env');
dotenv.config({ path: envPath });
console.log(`[Answering Agent ESM - Consensus] Loading .env from backend: ${envPath}`);


// --- Import necessary services using dynamic import ---
// Construct absolute paths to compiled JS files in dist
const servicesBasePath = path.resolve(__dirname, '../../packages/backend/dist/services');
const recallServicePath = path.join(servicesBasePath, 'recallService.js');
const filecoinServicePath = path.join(servicesBasePath, 'filecoinService.js');
const generatorServicePath = path.join(servicesBasePath, 'generatorService.js');

let recallService, filecoinService, generatorServiceModule;
// Destructure functions needed from recallService
let getPendingJobs, getObjectData, logErrorEvent, addObjectToBucket;
// Destructure function needed from filecoinService
let fetchContentByCid;
// Destructure function needed from generatorService
let generateAnswerFromContent;

try {
    console.log(`[Answering Agent ESM - Consensus] Importing services...`);
    // Use await import with file URLs for CJS interop
    recallService = await import(pathToFileURL(recallServicePath).href);
    ({ getPendingJobs, getObjectData, logErrorEvent, addObjectToBucket } = recallService.default || recallService);

    filecoinService = await import(pathToFileURL(filecoinServicePath).href);
    ({ fetchContentByCid } = filecoinService.default || filecoinService);

    generatorServiceModule = await import(pathToFileURL(generatorServicePath).href);
    generateAnswerFromContent = generatorServiceModule.generateAnswerFromContent || generatorServiceModule.default?.generateAnswerFromContent;

    // --- Validate Imports ---
    if (typeof getPendingJobs !== 'function') throw new Error('Failed to import getPendingJobs');
    if (typeof getObjectData !== 'function') throw new Error('Failed to import getObjectData');
    if (typeof logErrorEvent !== 'function') throw new Error('Failed to import logErrorEvent');
    if (typeof addObjectToBucket !== 'function') throw new Error('Failed to import addObjectToBucket');
    if (typeof fetchContentByCid !== 'function') throw new Error('Failed to import fetchContentByCid');
    if (typeof generateAnswerFromContent !== 'function') {
        const availableKeys = Object.keys(generatorServiceModule || {});
        const defaultKeys = generatorServiceModule?.default ? Object.keys(generatorServiceModule.default) : [];
        throw new Error(`Failed to find 'generateAnswerFromContent' in imported module. Available keys: [${availableKeys.join(', ')}]. Default export keys: [${defaultKeys.join(', ')}]`);
     }
    console.log('[Answering Agent ESM - Consensus] All service functions imported successfully.');

} catch (importError) {
    console.error("[Answering Agent ESM - Consensus] FATAL: Failed to import required services.", importError);
    process.exit(1);
}


// --- Agent Configuration ---
const POLLING_INTERVAL_MS = 15000; // Check every 15 seconds
const AGENT_ID = `answerer_esm_consensus_${process.env.POD_NAME || Math.random().toString(16).substring(2, 10)}`;
const QUESTIONS_RECALL_PREFIX = "questions/";
const ANSWERS_RECALL_PREFIX = "answers/"; // Base prefix for storing answers

let isShuttingDown = false;
let pollingTimeoutId = null;

console.log(`[Answering Agent ESM - Consensus] Starting | ID: ${AGENT_ID}`);

// --- Helper function ---
function truncateText(text, maxLength) {
    if (!text) return '';
    const strText = String(text);
    if (strText.length <= maxLength) return strText;
    return strText.substring(0, maxLength - 3) + '...';
}

/**
 * Logs this agent's specific answer to Recall.
 * Uses a unique key: /answers/{requestContext}/{agentId}.json
 * Calls the imported addObjectToBucket directly.
 */
async function logAgentAnswer(answer, agentId, requestContext) {
     const key = `${ANSWERS_RECALL_PREFIX}${requestContext}/${agentId}.json`;
     const data = {
         answer,
         answeringAgentId: agentId,
         status: 'Submitted',
         timestamp: new Date().toISOString(),
         requestContext
     };
     const result = await addObjectToBucket(data, key); // Use imported function
     console.log(`[Recall Service via Agent] Logged Agent Answer | Context: ${requestContext.substring(0,10)} | Agent: ${agentId.substring(0,10)} | Key: ${key} | Success: ${result.success} | Error: ${result.error || 'None'}`);
     return result.success ? key : undefined;
}


// --- Process Job Function for Consensus ---
async function processQuestionJob(jobKey) {
    console.log(`[Answering Agent ESM - Consensus ${AGENT_ID}] Processing job | Key: ${jobKey}`);
    let jobData = null;
    let requestContext = 'unknownContext';

    try {
        // 1. Fetch Job Data
        jobData = await getObjectData(jobKey);
        if (!jobData) { console.warn(`[Answering Agent ESM - Consensus ${AGENT_ID}] Job data not found for key ${jobKey}. Skipping.`); return; }
        if (typeof jobData !== 'object' || jobData === null) { throw new Error(`Invalid job data type: ${typeof jobData}`); }
        if (!jobData.question || !jobData.cid || !jobData.requestContext) { throw new Error(`Job data missing required fields.`); }
        requestContext = jobData.requestContext;

        // 2. Check if THIS agent already answered THIS question (Optional)
        const ownAnswerKey = `${ANSWERS_RECALL_PREFIX}${requestContext}/${AGENT_ID}.json`;
        const ownExistingAnswer = await getObjectData(ownAnswerKey);
        if (ownExistingAnswer) {
            console.log(`[Answering Agent ESM - Consensus ${AGENT_ID}] This agent already answered context ${requestContext}. Skipping job ${jobKey}.`);
            return;
        }

        // 3. Fetch Content
        console.log(`[Answering Agent ESM - Consensus ${AGENT_ID}] Fetching content | CID: ${jobData.cid.substring(0, 10)}... | Context: ${requestContext}`);
        const content = await fetchContentByCid(jobData.cid);
        if (!content) { throw new Error(`Failed to fetch content for CID ${jobData.cid}.`); }
        console.log(`[Answering Agent ESM - Consensus ${AGENT_ID}] Content fetched (Length: ${content.length}) | Context: ${requestContext}`);

        // 4. Generate Answer
        console.log(`[Answering Agent ESM - Consensus ${AGENT_ID}] Generating answer... | Context: ${requestContext}`);
        const answer = await generateAnswerFromContent(jobData.question, content, requestContext);
        if (typeof answer !== 'string' || answer.startsWith('Error:')) { throw new Error(`LLM failed to generate answer: ${answer || 'Empty response'}`); }
        console.log(`[Answering Agent ESM - Consensus ${AGENT_ID}] Answer generated: "${truncateText(answer, 100)}" | Context: ${requestContext}`);

        // 5. Log THIS Agent's Answer to Recall (uses unique key)
        console.log(`[Answering Agent ESM - Consensus ${AGENT_ID}] Attempting logAgentAnswer -> addObjectToBucket... | Context: ${requestContext}`);
        const answerKey = await logAgentAnswer(answer, AGENT_ID, requestContext); // Use the specific logging function
        if (!answerKey) {
             console.error(`[Answering Agent ESM - Consensus ${AGENT_ID}] CRITICAL: Failed to log agent answer for context ${requestContext}. Job ${jobKey} processing incomplete. Check recallService logs.`);
             return;
        } else {
            console.log(`[Answering Agent ESM - Consensus ${AGENT_ID}] Agent answer logged successfully | Key: ${answerKey} | Context: ${requestContext}`);
        }

        // --- DO NOT DELETE THE ORIGINAL QUESTION JOB ---
        console.log(`[Answering Agent ESM - Consensus ${AGENT_ID}] Finished processing job ${jobKey} (original question NOT deleted) | Context: ${requestContext}`);

    } catch (error) { // Catch errors from fetch, generate, or unexpected issues
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[Answering Agent ESM - Consensus ${AGENT_ID}] Error processing job ${jobKey}: ${errorMessage}`);
        try {
            await logErrorEvent({ stage: 'AnsweringAgentConsensusProcessJob', error: errorMessage, originalJobKey: jobKey, agentId: AGENT_ID }, requestContext );
        } catch (logError) {
            console.error(`[Answering Agent ESM - Consensus ${AGENT_ID}] FAILED to log processing error to Recall for context ${requestContext}. Original Error: ${errorMessage}. Log Error: ${logError.message}`);
        }
    }
}

// --- Polling Loop ---
async function pollLoop() {
    if (isShuttingDown) { console.log(`[Answering Agent ESM - Consensus ${AGENT_ID}] Shutdown signal received. Stopping polling.`); return; }
    try {
        const pendingJobs = await getPendingJobs(QUESTIONS_RECALL_PREFIX);
        if (pendingJobs.length > 0) {
            console.log(`[Answering Agent ESM - Consensus ${AGENT_ID}] Found ${pendingJobs.length} potential question jobs to check.`);
            // Process sequentially
            for (const jobInfo of pendingJobs) {
                if (isShuttingDown) break;
                if (jobInfo && jobInfo.key) {
                    await processQuestionJob(jobInfo.key);
                } else { console.warn(`[Answering Agent ESM - Consensus ${AGENT_ID}] Received invalid job info during poll:`, jobInfo); }
            }
        }
    } catch (error) { console.error(`[Answering Agent ESM - Consensus ${AGENT_ID}] Error during polling loop:`, error.message || error); }
    finally {
        if (!isShuttingDown) { pollingTimeoutId = setTimeout(pollLoop, POLLING_INTERVAL_MS); }
    }
}

// --- Start/Stop Logic ---
function startAgent() {
     pollLoop(); // Start the polling
}

function shutdownAgent() {
    if (isShuttingDown) return;
    console.log(`\n[Answering Agent ESM - Consensus ${AGENT_ID}] Shutdown signal received...`);
    isShuttingDown = true;
    if (pollingTimeoutId) {
        clearTimeout(pollingTimeoutId);
        console.log(`[Answering Agent ESM - Consensus ${AGENT_ID}] Polling stopped.`);
    }
    setTimeout(() => {
        console.log(`[Answering Agent ESM - Consensus ${AGENT_ID}] Exiting.`);
        process.exit(0);
    }, 5000); // Adjust timeout as needed
}

process.on('SIGTERM', shutdownAgent);
process.on('SIGINT', shutdownAgent);

// --- Start the Agent ---
startAgent();

// ==== ./scripts/agents/answeringAgent.js (Consensus Version - ESM) ====