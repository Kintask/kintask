// src/services/evaluationPayoutService.ts
import config from '../config';
// Import necessary types
import { QuestionData, AnswerData, EvaluationResult, JobStatus } from '../types';
// Import services
import {
    // Ensure ALL functions needed from recallService are imported correctly
    getObjectData,
    addObjectToBucket,
    logErrorEvent,
    findLogBucketAddressOrFail,
    getRecallClient, // Now imported
    getPendingJobs   // Now imported
} from './recallService';
import { fetchContentByCid } from './filecoinService';
// Import the specific evaluation type if needed, or use evaluateAnswerWithLLM's return type directly
import { evaluateAnswerWithLLM, LLMEvaluationResult } from './generatorService'; // Import the evaluation function
import {
    registerAgent,
    submitVerificationResult,
    triggerAggregation
} from './fvmContractService'; // FVM interactions
import { getAddress, Address } from 'viem'; // Import Address type
import { truncateText } from '../utils'; // Import truncateText

// --- Configuration ---
const EVALUATION_POLLING_INTERVAL_MS = 45000; // Check for answers to evaluate every 45s
const PAYOUT_POLLING_INTERVAL_MS = 120000; // Check for evaluations to payout every 2 mins
// Derive backend evaluator ID from its own signing key used for FVM/Recall
let BACKEND_EVALUATOR_ID: Address = "0xBackendEvaluatorPlaceholder"; // Placeholder
try {
     // Ensure account is initialized in recallService first if not done elsewhere
     // This assumes recallPrivateKey is used for evaluation/payout txns
     // Use dynamic import or ensure recallService is fully initialized before this runs
     const recallService = require('../services/recallService'); // Using require for safety if init order is tricky
     const backendAccount = recallService.initializeAccount(); // Get the initialized account
     BACKEND_EVALUATOR_ID = backendAccount.address;
     console.log(`[EvaluationPayoutService] Using Backend Evaluator/Payout ID: ${BACKEND_EVALUATOR_ID}`);
} catch(e: any) {
    console.error("[EvaluationPayoutService] ERROR: Could not derive backend agent ID from private key.", e.message);
    // Decide if this is fatal or if a placeholder is acceptable depending on requirements
    // process.exit(1); // Example: Exit if ID derivation fails
}


// Prefixes (ensure consistency with recallService)
const QUESTIONS_PREFIX = "questions/";
const ANSWERS_RECALL_PREFIX = "answers/";
const EVALUATION_RECALL_PREFIX = "evaluation/";
const PAYOUT_RECALL_PREFIX = "payouts/";

// TODO: Implement Secure Mapping from Agent IDs (Public Keys) to FVM Payout Addresses
// Example: Load from a JSON file, database, or ENV VAR mapped to request context if needed
const agentPayoutAddresses: Record<Address, Address | undefined> = {
    // Example entry (replace with actual data loading mechanism)
    // "0xAgentPublicKeyAddress1": "0xAgentPayoutAddress1",
};
if (Object.keys(agentPayoutAddresses).length === 0) {
     console.warn("[EvaluationPayoutService] WARNING: Agent Payout Address mapping is empty or not implemented! Payouts will likely fail.");
}


let evaluationPollTimer: NodeJS.Timeout | null = null;
let payoutPollTimer: NodeJS.Timeout | null = null;
let isShuttingDown = false; // Flag for graceful shutdown
let isEvaluating = false; // Prevent concurrent evaluation runs for the same context
let isProcessingPayout = false; // Prevent concurrent payout runs for the same context

/**
 * Logs the evaluation results for a specific request context.
 */
async function logEvaluationResult(evaluationData: EvaluationResult): Promise<string | undefined> {
    const requestContext = evaluationData.requestContext;
    const key = `${EVALUATION_RECALL_PREFIX}${requestContext}.json`;
    // Ensure required fields are set before logging
    evaluationData.evaluatorAgentId = evaluationData.evaluatorAgentId || BACKEND_EVALUATOR_ID;
    evaluationData.timestamp = evaluationData.timestamp || new Date().toISOString();
    // Ensure status is one of the allowed types for EvaluationResult['status']
    if (!['PendingPayout', 'Error', 'NoValidAnswers', 'PayoutComplete'].includes(evaluationData.status)) {
        console.warn(`[EvaluationPayoutService] Invalid status "${evaluationData.status}" provided for evaluation log. Defaulting to 'Error'. Context: ${requestContext}`);
        evaluationData.status = 'Error';
    }

    // Use the core addObjectToBucket which includes retries etc.
    const result = await addObjectToBucket(evaluationData, key);
    console.log(`[EvaluationPayoutService] Logged Evaluation | Context: ${requestContext.substring(0,10)} | Status: ${evaluationData.status} | Success: ${result.success} | Error: ${result.error || 'None'}`);
    return result.success ? key : undefined;
}

/**
 * Logs the payout attempt status.
 */
async function logPayoutStatus(payoutStatusData: any): Promise<string | undefined> {
    const requestContext = payoutStatusData.requestContext;
    const key = `${PAYOUT_RECALL_PREFIX}${requestContext}.json`;
    // Ensure required fields
    payoutStatusData.payoutAgentId = payoutStatusData.payoutAgentId || BACKEND_EVALUATOR_ID;
    payoutStatusData.payoutTimestamp = payoutStatusData.payoutTimestamp || new Date().toISOString();

    const result = await addObjectToBucket(payoutStatusData, key); // Use imported core function
    console.log(`[EvaluationPayoutService] Logged Payout Status | Context: ${requestContext.substring(0,10)} | Success: ${result.success} | Error: ${result.error || 'None'}`);
    return result.success ? key : undefined;
}

/**
 * Fetches original question and KB content for a given context.
 */
async function getQuestionAndContent(requestContext: string): Promise<{ questionData: QuestionData | null; content: string | null }> {
    const questionKey = `${QUESTIONS_PREFIX}${requestContext}.json`;
    const questionData = await getObjectData<QuestionData>(questionKey);
    if (!questionData || typeof questionData !== 'object' || !questionData.cid || !questionData.question) {
        console.warn(`[EvaluationPayoutService] Original question data missing or invalid fields for context ${requestContext}, key: ${questionKey}`);
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
    // Initialize structure conforming to EvaluationResult type
    const evaluationOutput: EvaluationResult = {
        requestContext: requestContext,
        results: [],
        status: 'Error', // Default to Error until successful completion
        evaluatorAgentId: BACKEND_EVALUATOR_ID, // Set backend ID
        timestamp: '', // Will be set before logging
    };

    try {
        const { questionData, content } = await getQuestionAndContent(requestContext);
        if (!questionData || !content) { // Need both for evaluation
            throw new Error(`Missing question data or content for context ${requestContext}. Cannot evaluate.`);
        }
        const excerpt = truncateText(content, 3500); // Use excerpt for LLM

        // Process each answer using Promise.all for concurrency
        const evaluationPromises = allAnswerKeys.map(async (answerKey) => {
            const answerData = await getObjectData<AnswerData>(answerKey);
            // Validate answer data
            if (!answerData || !answerData.answer || !answerData.answeringAgentId) {
                console.warn(`[EvaluationPayoutService] Skipping invalid answer data for key: ${answerKey}`);
                return null; // Skip this answer
            }

            console.log(`[EvaluationPayoutService] Evaluating answer from agent ${answerData.answeringAgentId.substring(0, 10)}... | Context: ${requestContext}`);
            // Call LLM to evaluate this specific answer
            const evaluation: LLMEvaluationResult = await evaluateAnswerWithLLM(
                questionData.question,
                answerData.answer,
                excerpt,
                requestContext,
                BACKEND_EVALUATOR_ID // Use backend's ID
            );

            // Return structured result for this answer
            return {
                answeringAgentId: answerData.answeringAgentId,
                answerKey: answerKey,
                evaluation: evaluation.evaluation,
                confidence: evaluation.confidence,
                explanation: evaluation.explanation
            };
        });

        // Wait for all evaluations to complete and filter out nulls (skipped answers)
        const completedEvaluations = (await Promise.all(evaluationPromises)).filter(result => result !== null);

        // Add valid results to the output object
        evaluationOutput.results = completedEvaluations as EvaluationResult['results']; // Type assertion

        // Determine status based on results
        if (evaluationOutput.results.length > 0) {
             // Check if *any* answer was correct to decide if payout is needed
             const hasCorrectAnswers = evaluationOutput.results.some(r => r.evaluation === 'Correct');
             evaluationOutput.status = hasCorrectAnswers ? 'PendingPayout' : 'NoValidAnswers';
        } else {
             console.warn(`[EvaluationPayoutService] No valid answers evaluated for context: ${requestContext}`);
             evaluationOutput.status = 'NoValidAnswers';
             evaluationOutput.results = []; // Ensure results array is empty
        }

        await logEvaluationResult(evaluationOutput); // Log the final evaluation object
        console.log(`[EvaluationPayoutService] Finished evaluation for context: ${requestContext}. Status: ${evaluationOutput.status}`);

    } catch (error: any) {
        const errorMessage = error.message || String(error);
        console.error(`[EvaluationPayoutService] Error during evaluation processing for context ${requestContext}: ${errorMessage}`);
        evaluationOutput.status = 'Error'; // Ensure status is Error
        // Log the errored evaluation state
        try { await logEvaluationResult(evaluationOutput); } catch { /* ignore secondary logging error */ }
        // Log a separate error event
        try { await logErrorEvent({ stage: 'EvaluateAnswers', error: errorMessage, requestContext }, requestContext); } catch { /* ignore */ }
    }
}

/**
 * Processes payout for a completed evaluation marked 'PendingPayout'.
 */
async function processPayout(evaluationData: EvaluationResult): Promise<void> {
    const requestContext = evaluationData.requestContext;
    console.log(`[EvaluationPayoutService] Processing payout for context: ${requestContext}`);
    // Initialize payout status log object
    let payoutStatus = {
        requestContext,
        stage: 'Start',
        success: false,
        message: 'Payout not completed',
        txHashes: {} as Record<string, string> // Initialize empty tx hash record
    };

    try {
        // Ensure status is actually pending
        if (evaluationData.status !== 'PendingPayout') {
             console.log(`[Payout Process] Evaluation status for ${requestContext} is already '${evaluationData.status}'. Skipping payout.`);
             return; // Don't process if not pending
        }

        // Fetch question data again to get original evidence CID
        const { questionData } = await getQuestionAndContent(requestContext);
        if (!questionData?.cid) {
             throw new Error("Cannot process payout without question data containing the evidence CID.");
        }
        const evidenceCid = questionData.cid;

        let submittedCount = 0;
        let fvmErrors = 0;
        // Loop through evaluated answers
        for (const result of evaluationData.results) {
            if (isShuttingDown) { payoutStatus.message = 'Shutdown during processing'; throw new Error('Shutdown signal received'); }

            // Process only 'Correct' evaluations for payout/submission
            if (result.evaluation === 'Correct') {
                const answeringAgentId = result.answeringAgentId;
                const checksumAgentId = getAddress(answeringAgentId); // Use checksummed ID for lookup
                const payoutAddress = agentPayoutAddresses[checksumAgentId];

                if (!payoutAddress) {
                    console.warn(`[Payout Process] No payout address mapped for agent ${checksumAgentId} (Original ID: ${answeringAgentId}). Skipping FVM submission.`);
                    await logErrorEvent({ stage: 'PayoutAgentNoAddress', agentId: answeringAgentId, requestContext }, requestContext);
                    continue; // Skip this agent's result
                }

                // Ensure agent registration on FVM contract
                try {
                    payoutStatus.stage = `RegisterAgent_${checksumAgentId.substring(0, 6)}`;
                    console.log(`[Payout Process] Ensuring FVM registration: Agent ${answeringAgentId} -> ${payoutAddress}...`);
                    const registerTx = await registerAgent(answeringAgentId, payoutAddress); // Assumes agentId is string used on contract
                    if (registerTx) payoutStatus.txHashes[`register_${checksumAgentId.substring(0, 6)}`] = registerTx;
                } catch (regError: any) {
                    console.error(`[Payout Process] Error ensuring agent registration for ${checksumAgentId}:`, regError.message);
                    await logErrorEvent({ stage: 'PayoutAgentRegisterFail', agentId: answeringAgentId, error: regError.message, requestContext }, requestContext);
                    fvmErrors++; // Count FVM errors
                    continue; // Skip submitting result if registration failed
                }

                // Submit the 'Correct' evaluation result to FVM
                 try {
                     payoutStatus.stage = `SubmitResult_${checksumAgentId.substring(0, 6)}`;
                     const confidence = result.confidence !== undefined ? result.confidence : 1.0;

                     console.log(`[Payout Process] Submitting result to FVM for ${answeringAgentId.substring(0,10)}... Verdict: Correct, Conf: ${confidence.toFixed(2)}`);
                     const submitTx = await submitVerificationResult(
                         requestContext,
                         evaluationData.evaluatorAgentId, // Backend is the "verifier"
                         'Correct',
                         confidence,
                         evidenceCid
                     );
                     if (submitTx) {
                         payoutStatus.txHashes[`submit_${checksumAgentId.substring(0, 6)}`] = submitTx;
                         submittedCount++;
                     } else {
                          console.error(`[Payout Process] FAILED to submit FVM result for agent ${checksumAgentId}.`);
                          await logErrorEvent({ stage: 'PayoutAgentSubmitFail', agentId: answeringAgentId, requestContext }, requestContext);
                          fvmErrors++;
                     }
                 } catch (submitError: any) {
                     console.error(`[Payout Process] Error submitting FVM result for agent ${checksumAgentId}:`, submitError.message);
                     await logErrorEvent({ stage: 'PayoutAgentSubmitError', agentId: answeringAgentId, error: submitError.message, requestContext }, requestContext);
                     fvmErrors++;
                 }
            }
        } // End loop

        // Trigger Aggregation on FVM (Optional)
        // Only trigger if we submitted results and had no submission/registration errors
        if (submittedCount > 0 && fvmErrors === 0) {
             try {
                 payoutStatus.stage = `TriggerAggregation`;
                 console.log(`[Payout Process] Triggering FVM aggregation for context ${requestContext}...`);
                 const aggregateTx = await triggerAggregation(requestContext);
                 if (aggregateTx) {
                     payoutStatus.txHashes[`aggregate`] = aggregateTx;
                     payoutStatus.success = true; // Mark overall success ONLY if aggregation is successful
                     payoutStatus.message = `Processed ${submittedCount} correct answers, triggered aggregation successfully.`;
                     console.log(`[Payout Process] Aggregation tx sent for ${requestContext}: ${aggregateTx}`);
                 } else {
                      payoutStatus.success = false;
                      payoutStatus.message = `Processed ${submittedCount} correct answers, but failed to trigger aggregation (returned null).`;
                      console.error(`[Payout Process] FAILED to trigger aggregation for ${requestContext}.`);
                      await logErrorEvent({ stage: 'PayoutAgentAggregateFail', requestContext }, requestContext);
                 }
             } catch (aggError: any) {
                 payoutStatus.success = false;
                 console.error(`[Payout Process] Error triggering aggregation for ${requestContext}:`, aggError.message);
                 payoutStatus.message = `Error triggering aggregation: ${aggError.message}`;
                 await logErrorEvent({ stage: 'PayoutAgentAggregateError', error: aggError.message, requestContext }, requestContext);
             }
        } else if (fvmErrors > 0) {
             payoutStatus.success = false;
             payoutStatus.message = `Processed ${submittedCount} results but encountered ${fvmErrors} FVM errors during registration/submission. Aggregation skipped.`;
             console.warn(`[Payout Process] Skipping aggregation for ${requestContext} due to FVM errors.`);
        } else { // submittedCount === 0
             payoutStatus.success = true; // No errors, just nothing to do
             payoutStatus.message = "No correct answers found to process for payout.";
             console.log(`[Payout Process] No correct answers found for context ${requestContext}. Skipping aggregation trigger.`);
        }

        // Update Evaluation Status in Recall based on final payout *attempt* success
        evaluationData.status = payoutStatus.success ? 'PayoutComplete' : 'Error';
        await logEvaluationResult(evaluationData); // Overwrite evaluation with final status

    } catch (error: any) {
        const errorMessage = error.message || String(error);
        console.error(`[EvaluationPayoutService] Error during payout processing for context ${requestContext}: ${errorMessage}`);
        payoutStatus.success = false; payoutStatus.message = errorMessage;
        try { await logErrorEvent({ stage: 'ProcessPayoutCatch', error: errorMessage, requestContext }, requestContext); } catch { /* ignore */ }
    } finally {
         // Log the final payout status details regardless of success/failure
         await logPayoutStatus(payoutStatus);
    }
}

/**
 * Polling function to find answers needing evaluation.
 */
async function pollForPendingEvaluations(): Promise<void> {
    if (isShuttingDown || isEvaluating) return;
    isEvaluating = true;
    console.log("[EvaluationPolling] Checking for answers needing evaluation...");
    let recall: any; let bucketAddr: Address;
    try {
        recall = await getRecallClient(); // Use imported function
        bucketAddr = await findLogBucketAddressOrFail(recall);
        const bucketManager = recall.bucketManager();

        const { result: answerListResult } = await bucketManager.query(bucketAddr, { prefix: ANSWERS_RECALL_PREFIX, delimiter: '/' });
        // Add type assertion for commonPrefixes
        const contextsWithAnswers: string[] = [...new Set((answerListResult?.commonPrefixes as string[] | undefined) || [])];

        if (!contextsWithAnswers.length) { /* console.log(`[EvaluationPolling] No contexts with answers found.`); */ }
        else {
            console.log(`[EvaluationPolling] Found ${contextsWithAnswers.length} contexts with potential answers.`);
            for (const answerDirPrefix of contextsWithAnswers) { // answerDirPrefix is string
                 if (isShuttingDown) break;
                 const parts = answerDirPrefix.replace(/\/$/, '').split('/');
                 const requestContext = parts.pop();
                 if (!requestContext || !requestContext.startsWith('req_')) continue;

                 const evaluationKey = `${EVALUATION_RECALL_PREFIX}${requestContext}.json`;
                 const payoutKey = `${PAYOUT_RECALL_PREFIX}${requestContext}.json`;
                 const [existingEval, existingPayout] = await Promise.all([ getObjectData(evaluationKey), getObjectData(payoutKey) ]);
                 if (existingEval || existingPayout) { continue; } // Skip if already processed

                 const { result: specificAnswersResult } = await bucketManager.query(bucketAddr, { prefix: answerDirPrefix });
                 const answerKeys = (specificAnswersResult?.objects || []).map((o: any)=>o.key).filter((k?: string): k is string => !!k && k.endsWith('.json'));
                 if (answerKeys.length > 0) { await evaluateAnswers(requestContext, answerKeys); }
             }
        }
    } catch (error: any) { console.error("[EvaluationPolling] Error during polling:", error.message); }
    finally {
        isEvaluating = false;
        if (!isShuttingDown) { evaluationPollTimer = setTimeout(pollForPendingEvaluations, EVALUATION_POLLING_INTERVAL_MS); }
    }
}

/**
 * Polling function to find evaluations needing payout.
 */
async function pollForPendingPayouts(): Promise<void> {
    if (isShuttingDown || isProcessingPayout) return;
    isProcessingPayout = true;
    console.log("[PayoutPolling] Checking for evaluations needing payout...");
    try {
        const evaluationJobs = await getPendingJobs(EVALUATION_RECALL_PREFIX); // Use imported function
        if (!evaluationJobs.length) { /* console.log("[PayoutPolling] No evaluations found."); */ }
        else {
            console.log(`[PayoutPolling] Found ${evaluationJobs.length} potential evaluations to process.`);
            for (const jobInfo of evaluationJobs) {
                 if (isShuttingDown) break;
                 const evaluationData = await getObjectData<EvaluationResult>(jobInfo.key);
                 if (evaluationData && evaluationData.status === 'PendingPayout') { await processPayout(evaluationData); }
            }
        }
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
    pollForPendingEvaluations();
    payoutPollTimer = setTimeout(() => { if (!isShuttingDown) pollForPendingPayouts(); }, 5000);
}

export function stopEvaluationPayoutService(): void {
    console.log("[EvaluationPayoutService] Stopping polling loops...");
    isShuttingDown = true;
    if (evaluationPollTimer) { clearTimeout(evaluationPollTimer); evaluationPollTimer = null; }
    if (payoutPollTimer) { clearTimeout(payoutPollTimer); payoutPollTimer = null; }
    isEvaluating = false; isProcessingPayout = false;
    console.log("[EvaluationPayoutService] Polling stopped.");
}

// ==== ./src/services/evaluationPayoutService.ts ====