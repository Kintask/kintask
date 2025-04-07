// src/services/evaluationPayoutService.ts
import config from '../config';
// Import necessary types
import { QuestionData, AnswerData, EvaluationResult, JobStatus, PayoutStatusData } from '../types';
// Import services
import {
    getObjectData,
    addObjectToBucket,
    logErrorEvent,
    findLogBucketAddressOrFail,
    getRecallClient, // Ensure imported
    getPendingJobs,  // Ensure imported
    logOverwrite,    // Ensure imported
    initializeAccount // Ensure imported
} from './recallService';
import { fetchContentByCid } from './filecoinService';
// Import the specific evaluation type if needed, or use evaluateAnswerWithLLM's return type directly
import { evaluateAnswerWithLLM, LLMEvaluationResult } from './generatorService'; // Import the evaluation function and type
import {
    registerAgent,
    submitVerificationResult,
    triggerAggregation
} from './fvmContractService'; // FVM interactions
import { getAddress, Address, isAddress } from 'viem'; // Import isAddress for validation
import { truncateText } from '../utils'; // Import truncateText

// --- Configuration ---
const EVALUATION_POLLING_INTERVAL_MS = 45000; // Check for answers to evaluate every 45s
const PAYOUT_POLLING_INTERVAL_MS = 120000; // Check for evaluations to payout every 2 mins
// Derive backend evaluator ID from its own signing key used for FVM/Recall
let BACKEND_EVALUATOR_ID: Address = "0xBackendEvaluatorPlaceholder"; // Placeholder
try {
     // Ensure account is initialized in recallService first
     const backendAccount = initializeAccount(); // Use exported initializeAccount
     BACKEND_EVALUATOR_ID = backendAccount.address;
     console.log(`[EvaluationPayoutService] Using Backend Evaluator/Payout ID: ${BACKEND_EVALUATOR_ID}`);
} catch(e: any) {
    console.error("[EvaluationPayoutService] ERROR: Could not derive backend agent ID from private key.", e.message);
}


// Prefixes (ensure consistency with recallService)
const QUESTIONS_PREFIX = "questions/";
const ANSWERS_RECALL_PREFIX = "answers/";
const EVALUATION_RECALL_PREFIX = "evaluation/";
const PAYOUT_RECALL_PREFIX = "payouts/";

// TODO: Implement Secure Mapping from Agent IDs (Public Keys) to FVM Payout Addresses
const agentPayoutAddresses: Record<Address, Address | undefined> = {
    // Example: [getAddress("0xAgentPublicKeyAddress1")]: getAddress("0xAgentPayoutAddress1"),
    // Ensure keys and values are checksummed if needed elsewhere
    [getAddress("0xe6272C7fBF8696d269c3d37c18AFA112ADeD9ac7")]: getAddress("0x25D40008ffC27D95D506224a246916d7E7ac0f36") // EXAMPLE - REPLACE
};
if (Object.keys(agentPayoutAddresses).length === 0) {
     console.warn("[EvaluationPayoutService] WARNING: Agent Payout Address mapping is empty!");
} else {
    console.log("[EvaluationPayoutService] Loaded Agent Payout Address Mappings:", agentPayoutAddresses);
}


let evaluationPollTimer: NodeJS.Timeout | null = null;
let payoutPollTimer: NodeJS.Timeout | null = null;
let isShuttingDown = false; // Flag for graceful shutdown
let isEvaluating = false; // Prevent concurrent evaluation runs for the same context
let isProcessingPayout = false; // Prevent concurrent payout runs for the same context

/**
 * Logs the evaluation results for a specific request context. Uses logOverwrite.
 */
async function logEvaluationResult(evaluationData: EvaluationResult): Promise<string | undefined> {
    const requestContext = evaluationData.requestContext;
    const key = `${EVALUATION_RECALL_PREFIX}${requestContext}.json`;
    evaluationData.evaluatorAgentId = evaluationData.evaluatorAgentId || BACKEND_EVALUATOR_ID;
    evaluationData.timestamp = evaluationData.timestamp || new Date().toISOString();
    // Ensure status matches the allowed types in EvaluationResult
    const validStatuses: EvaluationResult['status'][] = ['PendingPayout', 'Error', 'NoValidAnswers', 'PayoutComplete'];
    if (!validStatuses.includes(evaluationData.status)) {
        console.warn(`[EvaluationPayoutService] Invalid status "${evaluationData.status}" for evaluation log. Defaulting to 'Error'. Context: ${requestContext}`);
        evaluationData.status = 'Error';
    }

    // Use logOverwrite from recallService
    const resultKey = await logOverwrite(evaluationData, key, "logEvaluationResult");
    console.log(`[EvaluationPayoutService] Logged Evaluation | Context: ${requestContext.substring(0,10)} | Status: ${evaluationData.status} | Overwrite Success: ${!!resultKey}`);
    return resultKey;
}

/**
 * Logs the payout attempt status. Uses logOverwrite.
 */
async function logPayoutStatus(payoutStatusData: PayoutStatusData): Promise<string | undefined> {
    const requestContext = payoutStatusData.requestContext;
    const key = `${PAYOUT_RECALL_PREFIX}${requestContext}.json`;
    payoutStatusData.payoutAgentId = payoutStatusData.payoutAgentId || BACKEND_EVALUATOR_ID;
    payoutStatusData.payoutTimestamp = payoutStatusData.payoutTimestamp || new Date().toISOString();

    // Use logOverwrite from recallService
    const resultKey = await logOverwrite(payoutStatusData, key, "logPayoutStatus");
    console.log(`[EvaluationPayoutService] Logged Payout Status | Context: ${requestContext.substring(0,10)} | Success Flag: ${payoutStatusData.success} | Overwrite Success: ${!!resultKey}`);
    return resultKey;
}

/**
 * Fetches original question and KB content for a given context.
 */
async function getQuestionAndContent(requestContext: string): Promise<{ questionData: QuestionData | null; content: string | null }> {
    const questionKey = `${QUESTIONS_PREFIX}${requestContext}.json`;
    const questionData = await getObjectData<QuestionData>(questionKey);
    if (!questionData || typeof questionData !== 'object' || !questionData.cid || !questionData.question) {
        console.warn(`[EvaluationPayoutService] Original question data missing or invalid for context ${requestContext}, key: ${questionKey}`);
        return { questionData: null, content: null };
    }
    const content = await fetchContentByCid(questionData.cid);
    if (!content) {
        console.warn(`[EvaluationPayoutService] Failed to fetch KB content for context ${requestContext} (CID: ${questionData.cid})`);
        return { questionData, content: null }; // Return question data even if content fetch fails
    }
    return { questionData, content };
}

/**
 * Evaluates all answers submitted for a given request context.
 */
async function evaluateAnswers(requestContext: string, allAnswerKeys: string[]): Promise<void> {
    console.log(`[EvaluationPayoutService] Evaluating ${allAnswerKeys.length} answers for context: ${requestContext}`);
    const evaluationOutput: EvaluationResult = {
        requestContext: requestContext, results: [], status: 'Error', // Default
        evaluatorAgentId: BACKEND_EVALUATOR_ID, timestamp: '',
    };

    try {
        const { questionData, content } = await getQuestionAndContent(requestContext);
        if (!questionData || !content) { throw new Error(`Missing question/content for ${requestContext}`); }
        const excerpt = truncateText(content, 3500);

        const evaluationPromises = allAnswerKeys.map(async (answerKey) => {
            const answerData = await getObjectData<AnswerData>(answerKey);
            if (!answerData?.answer || !answerData?.answeringAgentId) { return null; }
            console.log(`[EvaluationPayoutService] Evaluating answer from agent ${answerData.answeringAgentId.substring(0, 10)}...`);
            const evaluation: LLMEvaluationResult = await evaluateAnswerWithLLM( questionData.question, answerData.answer, excerpt, requestContext, BACKEND_EVALUATOR_ID );
            return { answeringAgentId: answerData.answeringAgentId, answerKey, evaluation: evaluation.evaluation, confidence: evaluation.confidence, explanation: evaluation.explanation };
        });

        const completedEvaluations = (await Promise.all(evaluationPromises)).filter(Boolean);
        evaluationOutput.results = completedEvaluations as EvaluationResult['results'];

        if (evaluationOutput.results.length > 0) {
             const hasCorrectAnswers = evaluationOutput.results.some(r => r.evaluation === 'Correct');
             evaluationOutput.status = hasCorrectAnswers ? 'PendingPayout' : 'NoValidAnswers';
        } else {
             console.warn(`[EvaluationPayoutService] No valid answers evaluated for context: ${requestContext}`);
             evaluationOutput.status = 'NoValidAnswers';
        }
        await logEvaluationResult(evaluationOutput); // Log result (uses overwrite)
        console.log(`[EvaluationPayoutService] Finished evaluation for context: ${requestContext}. Status: ${evaluationOutput.status}`);

    } catch (error: any) {
        const errorMessage = error.message || String(error);
        console.error(`[EvaluationPayoutService] Error during evaluation processing for context ${requestContext}: ${errorMessage}`);
        evaluationOutput.status = 'Error';
        try { await logEvaluationResult(evaluationOutput); } catch { /* ignore */ }
        try { await logErrorEvent({ stage: 'EvaluateAnswers', error: errorMessage, requestContext }, requestContext); } catch { /* ignore */ }
    }
}

/**
 * Processes payout for a completed evaluation marked 'PendingPayout'.
 * Uses the answeringAgentId directly as the payout address after validation.
 */
async function processPayout(evaluationData: EvaluationResult): Promise<void> {
    const requestContext = evaluationData.requestContext;
    const logPrefix = `[Payout Process Ctx: ${requestContext.substring(0, 6)}]`;
    console.log(`${logPrefix} Starting payout processing...`);

    // Initialize payout status log object matching PayoutStatusData type
    let payoutStatus: PayoutStatusData = {
        requestContext, stage: 'Start', success: false, message: 'Payout processing initiated.',
        processedAgents: 0, correctAnswers: 0, submissionsSent: 0, fvmErrors: 0,
        txHashes: {}, payoutAgentId: BACKEND_EVALUATOR_ID, payoutTimestamp: '',
    };
    let fvmErrors = 0; // Local counter for FVM errors in this run

    try {
        if (evaluationData.status !== 'PendingPayout') {
             console.log(`${logPrefix} Evaluation status is '${evaluationData.status}'. Skipping payout.`);
             return;
        }
        payoutStatus.stage = 'FetchQuestionData';
        const { questionData } = await getQuestionAndContent(requestContext);
        if (!questionData?.cid) { throw new Error("Missing question data/CID for payout."); }
        const evidenceCid = questionData.cid;
        console.log(`${logPrefix} Found question data. Evidence CID: ${evidenceCid.substring(0,10)}...`);

        let submittedCount = 0;
        payoutStatus.correctAnswers = evaluationData.results.filter(r => r.evaluation === 'Correct').length;
        payoutStatus.processedAgents = evaluationData.results.length;
        console.log(`${logPrefix} Processing ${payoutStatus.correctAnswers} correct answers out of ${payoutStatus.processedAgents} total.`);

        for (const result of evaluationData.results) {
            if (isShuttingDown) { throw new Error('Shutdown signal'); }
            if (result.evaluation === 'Correct') {
                const answeringAgentId = result.answeringAgentId; // This IS the payout address string
                payoutStatus.stage = `ValidateAddress_${answeringAgentId.substring(0, 10)}`;

                // Validate if the agent ID stored is a valid address
                if (!isAddress(answeringAgentId)) {
                     console.warn(`${logPrefix} Agent ID "${answeringAgentId}" is not a valid address. Skipping.`);
                     await logErrorEvent({ stage: 'PayoutAgentInvalidAddress', invalidAgentId: answeringAgentId, requestContext }, requestContext);
                     fvmErrors++; // Count as an error preventing payout
                     continue;
                }
                const payoutAddress = getAddress(answeringAgentId); // Use validated & checksummed address
                console.log(`${logPrefix} Agent ${payoutAddress.substring(0,10)}... evaluated Correct. Payout Address: ${payoutAddress}`);

                // Ensure agent registration on FVM contract
                try {
                    payoutStatus.stage = `RegisterAgent_${payoutAddress.substring(0, 6)}`;
                    console.log(`${logPrefix} Ensuring FVM registration: Agent ID "${answeringAgentId}" -> Addr ${payoutAddress}...`);
                    // Register using the string ID (which is the address) and the validated address
                    const registerTx = await registerAgent(answeringAgentId, payoutAddress);
                    if (registerTx) payoutStatus.txHashes[`register_${payoutAddress.substring(0, 6)}`] = registerTx;
                } catch (regError: any) { console.error(`${logPrefix} Error registering ${answeringAgentId}:`, regError.message); fvmErrors++; continue; }

                // Submit Evaluation Result
                try {
                    payoutStatus.stage = `SubmitResult_${payoutAddress.substring(0, 6)}`;
                    const confidence = result.confidence ?? 1.0;
                    console.log(`${logPrefix} Submitting FVM result for agent ${payoutAddress}...`);
                    // Backend Evaluator submits the result referencing the answering agent
                    const submitTx = await submitVerificationResult( requestContext, BACKEND_EVALUATOR_ID, 'Correct', confidence, evidenceCid );
                    if (submitTx) { payoutStatus.txHashes[`submit_${payoutAddress.substring(0, 6)}`] = submitTx; submittedCount++; }
                    else { console.error(`${logPrefix} FAILED submit FVM result for agent ${payoutAddress}.`); fvmErrors++; }
                } catch (submitError: any) { console.error(`${logPrefix} Error submitting FVM result for agent ${payoutAddress}:`, submitError.message); fvmErrors++; }
            }
        } // End loop

        payoutStatus.submissionsSent = submittedCount;
        payoutStatus.fvmErrors = fvmErrors; // Assign final count

        // Trigger Aggregation
        if (submittedCount > 0 && fvmErrors === 0) {
             try {
                 payoutStatus.stage = `TriggerAggregation`; console.log(`${logPrefix} Triggering FVM aggregation...`);
                 const aggregateTx = await triggerAggregation(requestContext);
                 if (aggregateTx) { payoutStatus.txHashes[`aggregate`] = aggregateTx; payoutStatus.success = true; payoutStatus.message = `Processed ${submittedCount}, triggered aggregation.`; }
                 else { payoutStatus.success = false; payoutStatus.message = `Processed ${submittedCount}, failed trigger aggregation.`; console.error(`FAILED trigger aggregation.`); }
             } catch (aggError: any) { payoutStatus.success = false; payoutStatus.message = `Error triggering aggregation: ${aggError.message}`; console.error(`Error triggering aggregation:`, aggError.message); }
        } else if (fvmErrors > 0) { payoutStatus.success = false; payoutStatus.message = `Processed ${submittedCount} results but had ${fvmErrors} FVM errors. Aggregation skipped.`; }
        else { payoutStatus.success = true; payoutStatus.message = "No correct answers processed for payout."; }

        // Update Evaluation Status
        evaluationData.status = payoutStatus.success ? 'PayoutComplete' : 'Error';
        await logEvaluationResult(evaluationData); // Uses logOverwrite internally now

    } catch (error: any) {
        const errorMessage = error.message || String(error);
        console.error(`${logPrefix} Error during payout processing: ${errorMessage}`);
        payoutStatus.success = false; payoutStatus.message = errorMessage;
        payoutStatus.fvmErrors = fvmErrors; // Log fvm error count if top-level catch happens
        try { await logErrorEvent({ stage: 'ProcessPayoutCatch', error: errorMessage, requestContext }, requestContext); } catch { /* ignore */ }
        if(evaluationData && evaluationData.status !== 'Error'){ try { evaluationData.status = 'Error'; await logEvaluationResult(evaluationData); } catch { /* ignore */ } }
    } finally {
         await logPayoutStatus(payoutStatus); // Log final payout status object
         isProcessingPayout = false; // Release lock AFTER logging final status
    }
}

/** Polling function for evaluations. */
async function pollForPendingEvaluations(): Promise<void> {
    if (isShuttingDown || isEvaluating) return;
    isEvaluating = true;
    // console.log("[EvaluationPolling] Checking for answers needing evaluation..."); // Less verbose
    let recall: any; let bucketAddr: Address;
    try {
        recall = await getRecallClient();
        bucketAddr = await findLogBucketAddressOrFail(recall);
        const bucketManager = recall.bucketManager();
        const { result: answerListResult } = await bucketManager.query(bucketAddr, { prefix: ANSWERS_RECALL_PREFIX, delimiter: '/' });
        const contextsWithAnswers: string[] = [...new Set((answerListResult?.commonPrefixes as string[] | undefined) || [])];

        if (contextsWithAnswers.length > 0) {
            console.log(`[EvaluationPolling] Found ${contextsWithAnswers.length} contexts with potential answers.`);
            for (const answerDirPrefix of contextsWithAnswers) {
                 if (isShuttingDown) break;
                 const parts = (answerDirPrefix as string).replace(/\/$/, '').split('/');
                 const requestContext = parts.pop();
                 if (!requestContext || !requestContext.startsWith('req_')) continue;

                 const evaluationKey = `${EVALUATION_RECALL_PREFIX}${requestContext}.json`;
                 const payoutKey = `${PAYOUT_RECALL_PREFIX}${requestContext}.json`;
                 const [existingEval, existingPayout] = await Promise.all([ getObjectData(evaluationKey), getObjectData(payoutKey) ]);
                 if (existingEval || existingPayout) { continue; } // Skip if already processed

                 const { result: specificAnswersResult } = await bucketManager.query(bucketAddr, { prefix: answerDirPrefix });
                 const answerKeys = (specificAnswersResult?.objects || []).map((o: any)=>o.key).filter((k?: string): k is string => !!k && k.endsWith('.json'));
                 if (answerKeys.length > 0) {
                     console.log(`[EvaluationPolling] Triggering evaluation for context ${requestContext} (${answerKeys.length} answers).`);
                     await evaluateAnswers(requestContext, answerKeys);
                 } else {
                     // console.log(`[EvaluationPolling] No answer files found under prefix ${answerDirPrefix}.`); // Less verbose
                 }
             }
        }
    } catch (error: any) { console.error("[EvaluationPolling] Error during polling:", error.message); }
    finally {
        isEvaluating = false;
        if (!isShuttingDown) { evaluationPollTimer = setTimeout(pollForPendingEvaluations, EVALUATION_POLLING_INTERVAL_MS); }
    }
}

/** Polling function for payouts. */
async function pollForPendingPayouts(): Promise<void> {
    if (isShuttingDown || isProcessingPayout) return;
    isProcessingPayout = true;
    console.log("[PayoutPolling] Checking for evaluations needing payout...");
    try {
        const evaluationJobs = await getPendingJobs(EVALUATION_RECALL_PREFIX); // Use imported function
        if (evaluationJobs.length > 0) {
            console.log(`[PayoutPolling] Found ${evaluationJobs.length} potential evaluations to process.`);
            for (const jobInfo of evaluationJobs) {
                 if (isShuttingDown) break;
                 if (!jobInfo || !jobInfo.key) { console.warn(`[PayoutPolling] Invalid job info received:`, jobInfo); continue; }

                 const evaluationData = await getObjectData<EvaluationResult>(jobInfo.key);
                 if (evaluationData?.status === 'PendingPayout') { // Check specific status
                     console.log(`[PayoutPolling] ✅ Found pending payout for context ${evaluationData.requestContext}. Starting processing...`);
                     await processPayout(evaluationData);
                 } else if (evaluationData) {
                     // console.log(`[PayoutPolling] ⏭️ Skipping payout for context ${evaluationData.requestContext} (Key: ${jobInfo.key}). Status: '${evaluationData.status}'.`); // Less verbose
                 } else {
                     // console.warn(`[PayoutPolling] Could not fetch data for evaluation key ${jobInfo.key}. Skipping.`); // Less verbose
                 }
            }
        }
        // else { console.log("[PayoutPolling] No evaluation objects found needing payout this cycle."); } // Less verbose
    } catch (error: any) { console.error("[PayoutPolling] Error during polling:", error.message); }
    finally {
        isProcessingPayout = false;
        if (!isShuttingDown) { payoutPollTimer = setTimeout(pollForPendingPayouts, PAYOUT_POLLING_INTERVAL_MS); }
    }
}


// --- Service Start/Stop ---
export function startEvaluationPayoutService(): void {
    if (evaluationPollTimer || payoutPollTimer) { console.warn("[EvaluationPayoutService] Polling loops already seem started."); return; }
    isShuttingDown = false;
    console.log("[EvaluationPayoutService] Starting polling loops...");
    setTimeout(() => { if (!isShuttingDown) pollForPendingEvaluations(); }, Math.random() * 1000);
    payoutPollTimer = setTimeout(() => { if (!isShuttingDown) pollForPendingPayouts(); }, 5000 + Math.random() * 1000);
}

export function stopEvaluationPayoutService(): void {
    console.log("[EvaluationPayoutService] Stopping polling loops...");
    isShuttingDown = true;
    if (evaluationPollTimer) { clearTimeout(evaluationPollTimer); evaluationPollTimer = null; }
    if (payoutPollTimer) { clearTimeout(payoutPollTimer); payoutPollTimer = null; }
    isEvaluating = false; isProcessingPayout = false; // Reset locks on stop
    console.log("[EvaluationPayoutService] Polling stopped.");
}

// ==== ./src/services/evaluationPayoutService.ts ====