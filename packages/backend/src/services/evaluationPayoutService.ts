import config from '../config';
import {
    QuestionData,
    AnswerData, // Assumes this now includes validationUID?
    EvaluationResult, // Assumes results array items now include validationUID?
    PayoutStatusData,
} from '../types'; // Adjust import path as needed
import {
    logEvaluationResult as recallLogEvaluationResult,
    logPayoutStatus as recallLogPayoutStatus,
    getObjectData,
    findLogBucketAddressOrFail,
    getRecallClient,
    getPendingJobs,
    initializeAccount,
} from './recallService'; // Adjust import path as needed
import { fetchContentByCid } from './filecoinService'; // Adjust import path as needed
import { evaluateAnswerWithLLM, LLMEvaluationResult } from './generatorService'; // Adjust import path as needed
import {
    payoutToAgentOnchain,
    // triggerAggregation // Keep commented if not used
} from './fvmContractService'; // Adjust import path as needed
import { getAddress, Address, isAddress } from 'viem';
import { truncateText } from '../utils'; // Adjust import path as needed

// --- Configuration ---
const EVALUATION_POLLING_INTERVAL_MS = 95000;
const PAYOUT_POLLING_INTERVAL_MS = 140000;
const EVALUATION_WAIT_TIME_MS = 60_000; // 1 minute wait after question

let BACKEND_EVALUATOR_ID: Address = "0xBackendEvaluatorPlaceholder";
try {
    const backendAccount = initializeAccount(); // Ensure this provides the correct account
    BACKEND_EVALUATOR_ID = backendAccount.address;
    console.log(`[EvaluationPayoutService] Using Backend Evaluator/Payout ID: ${BACKEND_EVALUATOR_ID}`);
} catch (e: any) {
    console.error("[EvaluationPayoutService] ERROR: Could not derive backend agent ID.", e.message);
    // Consider if you should exit or continue with a placeholder
}

// --- Prefixes and Keys ---
const CONTEXT_DATA_PREFIX = "reqs/";
const getQuestionKey = (ctx: string) => `${CONTEXT_DATA_PREFIX}${ctx}/question.json`;
const getAnswersPrefix = (ctx: string) => `${CONTEXT_DATA_PREFIX}${ctx}/answers/`;
const getEvaluationKey = (ctx: string) => `${CONTEXT_DATA_PREFIX}${ctx}/evaluation.json`;
const getPayoutKey = (ctx: string) => `${CONTEXT_DATA_PREFIX}${ctx}/payout.json`;

// --- State ---
let evaluationPollTimer: NodeJS.Timeout | null = null;
let payoutPollTimer: NodeJS.Timeout | null = null;
let isShuttingDown = false;
let isEvaluatingMap = new Map<string, boolean>();
let isProcessingPayoutMap = new Map<string, boolean>();

// --- Helper ---
async function getQuestionAndContent(requestContext: string): Promise<{ questionData: QuestionData | null, content: string | null }> {
    const questionKey = getQuestionKey(requestContext);
    const questionData = await getObjectData<QuestionData>(questionKey);
    if (!questionData?.cid || !questionData?.question) {
        console.warn(`[Helper] Missing CID or question in ${questionKey}`);
        return { questionData: null, content: null };
    }
    const content = await fetchContentByCid(questionData.cid);
    if (!content) {
        console.warn(`[Helper] Failed to fetch content for CID ${questionData.cid}`);
        return { questionData, content: null }; // Return question data even if content fetch fails
    }
    return { questionData, content };
}

async function finalizePayoutLog(requestContext: string, evaluationStatus: 'NoValidAnswers' | 'Error') {
    const payoutStatus: PayoutStatusData = {
        requestContext,
        stage: `Finalized-${evaluationStatus}`, // Changed stage slightly
        success: false,
        message: evaluationStatus === 'NoValidAnswers'
            ? 'No valid answers found or eligible for payout.'
            : 'Evaluation or payout process resulted in an error.',
        processedAgents: 0, // Might want to populate this based on available data
        correctAnswers: 0,
        submissionsSent: 0,
        fvmErrors: 0,
        txHashes: {},
        payoutAgentId: BACKEND_EVALUATOR_ID,
        payoutTimestamp: new Date().toISOString(),
    };
    try {
        await recallLogPayoutStatus(payoutStatus, requestContext);
        console.log(`[Finalize] Logged final payout status for ${requestContext} as ${evaluationStatus}`);
    } catch (logErr: any) {
        console.error(`[Finalize] FATAL: Failed to log final payout status for ${requestContext}: ${logErr.message}`);
    }
}

/** Main LLM evaluation (waits 1min from question time) */
async function evaluateAnswers(requestContext: string) {
    if (isEvaluatingMap.get(requestContext)) {
        console.log(`[Eval] Evaluation already in progress for context: ${requestContext}`);
        return;
    }
    isEvaluatingMap.set(requestContext, true);
    console.log(`[Eval] ==== evaluateAnswers BEGIN for context: ${requestContext} ====`);

    // Default error state for evaluation output
    const evaluationOutput: EvaluationResult = {
        requestContext,
        results: [],
        status: 'Error', // Start assuming error
        evaluatorAgentId: BACKEND_EVALUATOR_ID,
        timestamp: new Date().toISOString(),
    };

    try {
        // 1. Check Question Timestamp & Wait Time
        const questionDataForTimestamp = await getObjectData<QuestionData>(getQuestionKey(requestContext));
        if (!questionDataForTimestamp?.timestamp) {
            console.log(`[Eval] No question timestamp for context: ${requestContext}, skipping evaluation.`);
            isEvaluatingMap.delete(requestContext);
            return; // Exit cleanly, not an error state for evaluation itself
        }
        const elapsed = Date.now() - new Date(questionDataForTimestamp.timestamp).getTime();
        if (elapsed < EVALUATION_WAIT_TIME_MS) {
            console.log(`[Eval] Not enough time elapsed since question for context: ${requestContext} (${Math.round(elapsed / 1000)}s / ${Math.round(EVALUATION_WAIT_TIME_MS / 1000)}s). Skipping.`);
            isEvaluatingMap.delete(requestContext);
            return; // Exit cleanly
        }

        // 2. Check if Evaluation Already Done
        const existingEval = await getObjectData<EvaluationResult>(getEvaluationKey(requestContext));
        if (existingEval) {
            console.log(`[Eval] Evaluation already exists for context: ${requestContext} (Status: ${existingEval.status}). Skipping.`);
            isEvaluatingMap.delete(requestContext);
            return; // Exit cleanly
        }

        // 3. Fetch Question Content (Needed for LLM)
        // Use the questionData we already fetched for the timestamp check
        const questionData = questionDataForTimestamp;
        const content = await fetchContentByCid(questionData.cid); // Fetch content associated with the question
        if (!content) {
            console.error(`[Eval] Failed to fetch question content (CID: ${questionData.cid}) for context: ${requestContext}. Cannot evaluate.`);
            // Log error state evaluation and exit
            evaluationOutput.status = 'Error';
            evaluationOutput.results = [{ // Add a placeholder error result if needed
                answerKey: 'N/A', answeringAgentId: '0x', confidence: 0, evaluation: 'Error', explanation: 'Failed to fetch question content.', fulfillmentUID: null, validationUID: null
            }];
            await recallLogEvaluationResult(evaluationOutput, requestContext);
            isEvaluatingMap.delete(requestContext);
            return;
        }

        // 4. List Answers from Recall
        const recall = await getRecallClient();
        const bucketAddr = await findLogBucketAddressOrFail(recall);
        const answerPrefix = getAnswersPrefix(requestContext);
        console.log(`[Eval] Querying Recall bucket ${bucketAddr} for answers with prefix: ${answerPrefix}`);
        const { result: answersResult } = await recall.bucketManager().query(bucketAddr, { prefix: answerPrefix });
        const allAnswerKeys = (answersResult?.objects || [])
            .map((o: any) => o.key as string | undefined) // Get keys
            .filter((k?: string): k is string => !!k && k.endsWith('.json')); // Filter valid keys

        console.log(`[Eval] Found ${allAnswerKeys.length} potential answer keys for context ${requestContext}.`);

        if (allAnswerKeys.length === 0) {
            console.log(`[Eval] No answers found for context: ${requestContext}. Logging status as NoValidAnswers.`);
            evaluationOutput.status = 'NoValidAnswers';
            await recallLogEvaluationResult(evaluationOutput, requestContext);
            isEvaluatingMap.delete(requestContext);
            return;
        }

        // 5. Evaluate Each Answer with LLM
        const excerpt = truncateText(content, 3500); // Truncate content for LLM context limit
        const evaluationPromises = allAnswerKeys.map(async (answerKey: any): Promise<EvaluationResult['results'][0] | null> => {
            try {
                const answerData = await getObjectData<AnswerData>(answerKey);
                if (!answerData?.answer || !answerData?.answeringAgentId || !answerData?.fulfillmentUID) {
                    console.warn(`[Eval] Skipping answer ${answerKey}: missing required data (answer, agentId, fulfillmentUID).`);
                    return null;
                }

                // Ensure agent ID is checksummed
                const agentId = getAddress(answerData.answeringAgentId);

                console.log(`[Eval] Evaluating answer from agent ${agentId} (key: ${answerKey})...`);
                const llmEval: LLMEvaluationResult = await evaluateAnswerWithLLM(
                    questionData.question,
                    answerData.answer,
                    excerpt,
                    requestContext,
                    BACKEND_EVALUATOR_ID // Pass evaluator ID for context/logging in LLM service if needed
                );
                console.log(`[Eval] LLM Result for ${answerKey}: ${llmEval.evaluation}, Confidence: ${llmEval.confidence}`);

                // *** Prepare the result object for EvaluationResult ***
                // *** Includes the NEW validationUID field ***
                return {
                    answeringAgentId: agentId,
                    answerKey: answerKey,
                    evaluation: llmEval.evaluation,
                    confidence: llmEval.confidence,
                    explanation: llmEval.explanation!,
                    fulfillmentUID: answerData.fulfillmentUID, // The AnswerStatement UID
                    validationUID: answerData.validationUID ?? null, // <<< The ZKPValidator UID
                };
            } catch (evalError: any) {
                console.error(`[Eval] Error processing answer ${answerKey}: ${evalError.message}`);
                return null; // Skip this answer if processing fails
            }
        });

        // 6. Aggregate Results and Determine Status
        const completedEvaluationsRaw = await Promise.all(evaluationPromises);
        const completedEvaluations = completedEvaluationsRaw.filter((r): r is EvaluationResult['results'][0] => r !== null);

        evaluationOutput.results = completedEvaluations;

        // Determine final status based on *valid* 'Correct' evaluations
        const hasCorrectAndValidatable = completedEvaluations.some(
            (r) => r.evaluation === 'Correct' && !!r.validationUID // <<< Check if 'Correct' AND has a validation UID
        );

        evaluationOutput.status = hasCorrectAndValidatable ? 'PendingPayout' : 'NoValidAnswers';

        console.log(`[Eval] Evaluation complete for context ${requestContext}. Status: ${evaluationOutput.status}. ${completedEvaluations.length} answers processed.`);
        if (!hasCorrectAndValidatable && completedEvaluations.some(r => r.evaluation === 'Correct')) {
            console.warn(`[Eval] Found 'Correct' answers for ${requestContext}, but none had a validationUID. Check agent logs.`);
        }


        // 7. Log Evaluation Result to Recall
        // (Optional: Add on-chain anchor logic here if desired using StringResultStatement - currently commented out)
        /*
        try {
            // Example: hash the evaluationOutput or get its CID
            // const evalHash = '0x...'; // Replace with actual hash/CID
            // await fvmContractService.anchorEvaluation(requestContext, evalHash); // Assuming function exists
        } catch (anchorErr: any) {
            console.error(`[Eval] WARNING: Failed to anchor evaluation result on-chain for ${requestContext}: ${anchorErr.message}`);
        }
        */

        await recallLogEvaluationResult(evaluationOutput, requestContext);
        console.log(`[Eval] Wrote evaluation results to Recall for context ${requestContext}`);

    } catch (error: any) {
        console.error(`[Eval] UNCAUGHT ERROR during evaluation for context ${requestContext}:`, error);
        evaluationOutput.status = 'Error'; // Ensure status reflects error
        try {
            // Attempt to log the error state
            await recallLogEvaluationResult(evaluationOutput, requestContext);
        } catch (logErr: any) {
            console.error(`[Eval] FATAL: Could not log evaluation error state for context ${requestContext}:`, logErr);
        }
    } finally {
        isEvaluatingMap.delete(requestContext); // Release lock
        console.log(`[Eval] ==== evaluateAnswers END for context: ${requestContext} ====`);
    }
}


async function processPayout(evaluationData: EvaluationResult): Promise<void> {
    const requestContext = evaluationData.requestContext;
    console.log(`[Payout] ========== PROCESS PAYOUT BEGIN for context: ${requestContext} ==========`);

    // Prevent concurrent processing for the same context
    if (isProcessingPayoutMap.get(requestContext)) {
        console.log(`[Payout] Already processing payout for ${requestContext}, skipping.`);
        return;
    }
    isProcessingPayoutMap.set(requestContext, true); // Set lock

    // Initialize payout status log - This object will be updated throughout the process
    let payoutStatus: PayoutStatusData = {
        requestContext,
        stage: 'Start', // Initial stage
        success: false, // Assume failure until proven otherwise
        message: 'Payout initiated.',
        processedAgents: evaluationData.results.length, // Total answers evaluated
        correctAnswers: evaluationData.results.filter(r => r.evaluation === 'Correct').length, // Correct per LLM
        submissionsSent: 0, // Successful on-chain collectPayment calls
        fvmErrors: 0, // Errors during on-chain collectPayment calls
        txHashes: {}, // Record of transaction hashes or errors per agent
        payoutAgentId: BACKEND_EVALUATOR_ID, // ID of this backend service instance
        payoutTimestamp: new Date().toISOString(), // Initial timestamp, will be updated
    };

    // Local counters for use within the main try block
    let fvmErrorsCountInTry = 0;
    let submittedCountInTry = 0;

    try {
        // === Step 1: Pre-checks ===

        // Check if payout log already exists (meaning process completed or failed definitively before)
        const existingPayout = await getObjectData<PayoutStatusData>(getPayoutKey(requestContext));
        if (existingPayout) {
            console.log(`[Payout] Payout log already exists for context: ${requestContext} (Stage: ${existingPayout.stage}). Skipping redundant processing.`);
            isProcessingPayoutMap.delete(requestContext); // Release lock
            return; // Exit
        }

        // Check if evaluation status allows payout attempt
        if (evaluationData.status !== 'PendingPayout') {
            console.log(`[Payout] Evaluation status is '${evaluationData.status}' (not 'PendingPayout') for context: ${requestContext}. Skipping payout attempt.`);
            // If status indicates no valid answers or an error occurred during evaluation,
            // finalize the payout log to reflect this, but don't attempt payouts.
            if (evaluationData.status === 'NoValidAnswers' || evaluationData.status === 'Error') {
                await finalizePayoutLog(requestContext, evaluationData.status);
            }
            isProcessingPayoutMap.delete(requestContext); // Release lock
            return; // Exit
        }
        payoutStatus.stage = 'ChecksPassed'; // Update stage

        // === Step 2: Get Payment Information ===
        console.log(`[Payout] Loading question data for context: ${requestContext}...`);
        const { questionData } = await getQuestionAndContent(requestContext); // Assumes this helper exists
        if (!questionData?.paymentUID) {
            // This is a fatal error for the payout process
            throw new Error(`Missing paymentUID in questionData for context: ${requestContext}. Cannot proceed with payout.`);
        }
        const paymentUID = questionData.paymentUID; // The UID of the ERC20PaymentStatement
        console.log(`[Payout] Found Payment Statement UID: ${paymentUID}`);
        payoutStatus.stage = 'PaymentUIDRetrieved';

        // === Step 3: Filter Eligible Payout Candidates ===
        // An answer is eligible if:
        // 1. The LLM marked it as 'Correct'.
        // 2. The agent successfully ran ZKP validation and stored the validationUID.
        const eligibleResults = evaluationData.results.filter(result =>
            result.evaluation === 'Correct' && !!result.validationUID // Check both conditions
        );

        if (eligibleResults.length === 0) {
            console.log(`[Payout] No eligible answers found for payout for context: ${requestContext} (LLM 'Correct' AND has validationUID). Finalizing as NoValidAnswers.`);
            payoutStatus.message = "No eligible answers found for payout (require LLM 'Correct' and ZKP Validation UID).";
            payoutStatus.stage = 'NoEligibleAgents';
            await finalizePayoutLog(requestContext, 'NoValidAnswers'); // Log specific final status

            // Update evaluation status to reflect this outcome definitively
            evaluationData.status = 'NoValidAnswers'; // Or a new status like 'PayoutNotAttempted'
            await recallLogEvaluationResult(evaluationData, requestContext);

            isProcessingPayoutMap.delete(requestContext); // Release lock
            return; // Exit
        }

        console.log(`[Payout] Found ${eligibleResults.length} eligible answer(s) for payout for context ${requestContext}.`);
        payoutStatus.stage = 'EligibleAgentsIdentified';


        // === Step 4: Attempt On-Chain Payouts ===
        console.log(`[Payout] Attempting payouts for ${eligibleResults.length} agent(s)...`);
        payoutStatus.stage = 'AttemptingOnchainPayouts';

        for (const [index, result] of eligibleResults.entries()) {
            const agentId = result.answeringAgentId;
            // We've already filtered, so validationUID is guaranteed to be a non-null string here
            const validationUID = result.validationUID!;

            console.log(`[Payout] Processing eligible result #${index + 1}/${eligibleResults.length}: Agent=${agentId}, ZKP_ValidationUID=${validationUID}`);

            try {
                // Call the FVM service to execute the collectPayment transaction
                // Pass the PaymentUID (the offer) and the ValidationUID (the proof of fulfillment)
                console.log(`[Payout] Calling fvmContractService.payoutToAgentOnchain(paymentUID: ${paymentUID}, fulfillmentUID: ${validationUID})`);
                const txResult = await payoutToAgentOnchain(paymentUID, validationUID);

                // Record successful transaction
                payoutStatus.txHashes[`payout_${agentId.substring(0, 8)}`] = txResult.hash;
                submittedCountInTry++; // Increment success counter
                console.log(`[Payout] ✅ Payout TX successful for Agent ${agentId}. Hash: ${txResult.hash}`);

            } catch (payError: any) {
                // Record failed transaction attempt
                fvmErrorsCountInTry++; // Increment error counter
                const errorMessage = payError?.message || String(payError);
                payoutStatus.txHashes[`error_${agentId.substring(0, 8)}_${fvmErrorsCountInTry}`] = `Failed: ${errorMessage}`;
                console.error(`[Payout] ❌ FVM PAYOUT ERROR for Agent ${agentId} (ValidationUID: ${validationUID}):`, errorMessage);
                // Log the error but continue to the next agent
            }
        } // End of loop through eligible agents

        // === Step 5: Finalize Payout Status After Attempts ===
        payoutStatus.submissionsSent = submittedCountInTry;
        payoutStatus.fvmErrors = fvmErrorsCountInTry;
        // Determine overall success: At least one payout succeeded AND there were NO errors.
        payoutStatus.success = (submittedCountInTry > 0 && fvmErrorsCountInTry === 0);
        payoutStatus.stage = payoutStatus.success ? 'PayoutComplete' : 'PayoutAttemptedWithErrors';
        payoutStatus.message = payoutStatus.success
            ? `Payout successful for ${submittedCountInTry} agent(s).`
            : `Payout attempted for ${submittedCountInTry} agent(s) with ${fvmErrorsCountInTry} FVM error(s). Check txHashes for details.`;

        console.log(`[Payout] Finished processing payouts for context ${requestContext}. Success: ${payoutStatus.success}, Sent: ${submittedCountInTry}, Errors: ${fvmErrorsCountInTry}`);

        // Update the EvaluationResult status based on the payout outcome
        // If payout was fully successful, mark evaluation as PayoutComplete.
        // If there were errors during payout, mark evaluation as Error.
        evaluationData.status = payoutStatus.success ? 'PayoutComplete' : 'Error';
        console.log(`[Payout] Updating evaluation status for ${requestContext} to: ${evaluationData.status}`);
        await recallLogEvaluationResult(evaluationData, requestContext);

    } catch (error: any) {
        // Catch errors from steps *before* the payout loop (e.g., fetching paymentUID)
        payoutStatus.success = false;
        payoutStatus.stage = 'FatalError'; // Indicate a critical failure before/during setup
        payoutStatus.message = `FATAL ERROR during payout process setup: ${error?.message || String(error)}`;
        // Assign fvmErrorsCountInTry which would be 0 if error happened before loop
        payoutStatus.fvmErrors = fvmErrorsCountInTry;
        console.error(`[Payout] ❌ FATAL EXCEPTION during payout process for context ${requestContext}: ${payoutStatus.message}`, error);

        // Attempt to update evaluation status to Error if it wasn't already
        if (evaluationData?.status && evaluationData.status !== 'Error') {
            try {
                evaluationData.status = 'Error';
                await recallLogEvaluationResult(evaluationData, requestContext);
            } catch (logErr: any) {
                console.error(`[Payout] Failed to log evaluation status update after fatal error for ${requestContext}: ${logErr.message}`);
            }
        }
    } finally {
        // === Step 6: Log Final Payout Status (Always Runs) ===
        payoutStatus.payoutTimestamp = new Date().toISOString(); // Set final timestamp
        console.log(`[Payout] Logging final payout status for context ${requestContext}:`, JSON.stringify(payoutStatus, null, 2));
        try {
            // Log the complete PayoutStatusData object to Recall
            await recallLogPayoutStatus(payoutStatus, requestContext);
        } catch (logErr: any) {
            console.error(`[Payout] FATAL: Could not log final payout status to Recall for context ${requestContext}: ${logErr.message}`);
            // This is a critical failure in logging the outcome.
        }
        isProcessingPayoutMap.delete(requestContext); // Release lock IMPORTANT: ensure this runs
        console.log(`[Payout] ========== PROCESS PAYOUT END for context: ${requestContext} ==========`);
    }
}

// == Polling Loops (Unchanged from your provided code) ==

async function pollForPendingEvaluations(): Promise<void> {
    if (isShuttingDown) return;
    // Avoid polling if an evaluation is already running (simple lock)
    if (Array.from(isEvaluatingMap.values()).some((status) => status === true)) {
        console.log("[EvalPoll] Evaluation in progress, delaying next poll.");
        if (!isShuttingDown) {
            evaluationPollTimer = setTimeout(pollForPendingEvaluations, EVALUATION_POLLING_INTERVAL_MS);
        }
        return;
    }
    console.log("[EvalPoll] Checking for pending evaluations...");
    try {
        const questionJobs = await getPendingJobs(CONTEXT_DATA_PREFIX); // Get keys matching prefix
        console.log(`[EvalPoll] Found ${questionJobs.length} potential question jobs.`);
        for (const jobInfo of questionJobs) {
            if (isShuttingDown) break;
            // Extract context ID, e.g., "req_..."
            const contextMatch = jobInfo.key.match(/reqs\/(req_[^/]+)\/question\.json$/);
            const requestContext = contextMatch ? contextMatch[1] : null;
            if (!requestContext || isEvaluatingMap.has(requestContext)) continue; // Skip if no context or already processing

            // Check timestamp requirement
            const questionData = await getObjectData<QuestionData>(getQuestionKey(requestContext));
            if (!questionData?.timestamp) {
                console.log(`[EvalPoll] Skipping ${requestContext}: No timestamp.`);
                continue;
            }
            const minTime = new Date(questionData.timestamp).getTime() + EVALUATION_WAIT_TIME_MS;
            if (Date.now() < minTime) {
                console.log(`[EvalPoll] Skipping ${requestContext}: Wait time not elapsed.`);
                continue;
            }

            // Check if evaluation or payout already done
            const evaluationKey = getEvaluationKey(requestContext);
            const payoutKey = getPayoutKey(requestContext);
            const [existingEval, existingPayout] = await Promise.all([
                getObjectData(evaluationKey),
                getObjectData(payoutKey),
            ]);

            if (!existingEval && !existingPayout) {
                // Check if any answers exist before triggering evaluation
                const recall = await getRecallClient();
                const bucketAddr = await findLogBucketAddressOrFail(recall);
                const answerPrefix = getAnswersPrefix(requestContext);
                const { result: answersResult } = await recall.bucketManager().query(bucketAddr, {
                    prefix: answerPrefix,
                    limit: 1, // Just need to know if at least one exists
                });
                const hasAnswers = answersResult?.objects?.length > 0;

                if (hasAnswers) {
                    console.log(`[EvalPoll] Triggering evaluation for ${requestContext}.`);
                    await evaluateAnswers(requestContext); // No await needed if we want polls to continue independently
                } else {
                    console.log(`[EvalPoll] Skipping ${requestContext}: No answers found yet.`);
                }
            } else {
                console.log(`[EvalPoll] Skipping ${requestContext}: Evaluation or Payout already exists.`);
            }
        }
    } catch (error: any) {
        console.error(`[EvalPoll] Error during polling for evaluations:`, error.message);
    } finally {
        if (!isShuttingDown) {
            evaluationPollTimer = setTimeout(pollForPendingEvaluations, EVALUATION_POLLING_INTERVAL_MS);
        }
    }
}

async function pollForPendingPayouts(): Promise<void> {
    // Exit if the service is shutting down
    if (isShuttingDown) {
        console.log("[PayoutPoll] Shutting down, stopping payout poll.");
        return;
    }

    // Avoid concurrent polling runs if one is already active (simple lock)
    if (Array.from(isProcessingPayoutMap.values()).some((status) => status === true)) {
        console.log("[PayoutPoll] Payout processing in progress, delaying next poll cycle.");
        // Schedule next poll and exit current one
        if (!isShuttingDown) {
            payoutPollTimer = setTimeout(pollForPendingPayouts, PAYOUT_POLLING_INTERVAL_MS);
        }
        return;
    }

    console.log("[PayoutPoll] Checking for pending payouts...");
    try {
        // Initialize Recall client and find the log bucket address
        const recall = await getRecallClient();
        const bucketAddr = await findLogBucketAddressOrFail(recall);

        // --- Query Strategy: List all keys under the base prefix and filter ---
        console.log(`[PayoutPoll] Querying Recall bucket ${bucketAddr} for evaluation files with prefix: ${CONTEXT_DATA_PREFIX}`);
        const { result: listResult } = await recall.bucketManager().query(bucketAddr, {
            prefix: CONTEXT_DATA_PREFIX, // Start search from base context prefix 'reqs/'
            delimiter: '' // List all keys flatly under the prefix
        });

        // Filter the results to get only keys ending with '/evaluation.json'
        const evaluationKeys = (listResult?.objects || [])
             .map((o: any) => o.key as string | undefined) // Get the key string
             .filter((k?: string): k is string => !!k && k.endsWith('/evaluation.json')); // Filter

        console.log(`[PayoutPoll] Found ${evaluationKeys.length} potential evaluation files to check.`);

        // Process each found evaluation file
        for (const evaluationKey of evaluationKeys) {
            if (isShuttingDown) break; // Check shutdown status within loop

            // Extract context ID from the key (e.g., "req_12345")
            const contextMatch = evaluationKey.match(/reqs\/(req_[^/]+)\/evaluation\.json$/);
            const requestContext = contextMatch ? contextMatch[1] : null;

            // Skip if context couldn't be extracted or if this context is already being processed
            if (!requestContext || isProcessingPayoutMap.has(requestContext)) {
                 if (!requestContext) console.warn(`[PayoutPoll] Could not extract context from key: ${evaluationKey}`);
                 // else console.log(`[PayoutPoll] Skipping ${requestContext}, already processing.`);
                 continue;
            }

            // Check if a payout log already exists for this context (meaning payout already finished/failed definitively)
            const payoutKey = getPayoutKey(requestContext);
            const existingPayout = await getObjectData<PayoutStatusData>(payoutKey);
            if (existingPayout) {
                 // console.log(`[PayoutPoll] Skipping ${requestContext}: Payout log already exists (Stage: ${existingPayout.stage}).`);
                 continue; // Already processed
            }

            // Fetch the evaluation data object
            const evaluationData = await getObjectData<EvaluationResult>(evaluationKey);
            if (!evaluationData) {
                 console.warn(`[PayoutPoll] Skipping ${requestContext}: Failed to fetch evaluation data from key ${evaluationKey}.`);
                 continue; // Cannot process without evaluation data
            }

            // --- Decide action based on evaluation status ---
            if (evaluationData.status === 'PendingPayout') {
                // If status indicates payout is ready, trigger the payout process
                console.log(`[PayoutPoll] Triggering payout process for ${requestContext} (Status: PendingPayout).`);
                // Call processPayout (don't await if polling should continue independently)
                processPayout(evaluationData).catch(err => {
                     // Catch errors specifically from processPayout to prevent crashing the poll loop
                     console.error(`[PayoutPoll] Error during async processPayout call for ${requestContext}: ${err.message}`);
                });
            } else if (
                evaluationData.status === 'NoValidAnswers' ||
                evaluationData.status === 'Error'
            ) {
                // If evaluation ended with no valid answers or an error,
                // ensure a final payout log is created to mark the end state.
                console.log(`[PayoutPoll] Finalizing payout log for ${requestContext} with terminal evaluation status: ${evaluationData.status}.`);
                // Call finalizePayoutLog (await is fine here as it's just logging)
                await finalizePayoutLog(requestContext, evaluationData.status);
            } else {
                 // Log other statuses found (e.g., PayoutComplete, PendingEvaluation) - no action needed here
                 // console.log(`[PayoutPoll] Skipping ${requestContext}: Evaluation status is '${evaluationData.status}'.`);
            }

        } // End for loop over evaluation keys

    } catch (error: any) {
        // Catch errors related to Recall client setup or the main query
        console.error(`[PayoutPoll] Error during polling loop: ${error.message}`);
        // Consider if specific errors should halt the service
    } finally {
        // Schedule the next poll regardless of errors in the current cycle, unless shutting down
        if (!isShuttingDown) {
            // console.log(`[PayoutPoll] Scheduling next poll in ${PAYOUT_POLLING_INTERVAL_MS / 1000} seconds.`);
            payoutPollTimer = setTimeout(pollForPendingPayouts, PAYOUT_POLLING_INTERVAL_MS);
        }
    }
}

// --- Service Start/Stop (Unchanged) ---
export function startEvaluationPayoutService(): void {
    if (evaluationPollTimer || payoutPollTimer) {
        console.warn("[EvaluationPayoutService] Polling loops already started.");
        return;
    }
    isShuttingDown = false;
    console.log("[EvaluationPayoutService] Starting polling loops...");
    // Start polling after a short random delay
    evaluationPollTimer = setTimeout(() => {
        if (!isShuttingDown) pollForPendingEvaluations();
    }, 10000 + Math.random() * 2000);
    payoutPollTimer = setTimeout(() => {
        if (!isShuttingDown) pollForPendingPayouts();
    }, 50000 + Math.random() * 2000); // Stagger payout polling slightly
}

export function stopEvaluationPayoutService(): void {
    console.log("[EvaluationPayoutService] Stopping polling loops...");
    isShuttingDown = true;
    if (evaluationPollTimer) { clearTimeout(evaluationPollTimer); evaluationPollTimer = null; }
    if (payoutPollTimer) { clearTimeout(payoutPollTimer); payoutPollTimer = null; }
    isEvaluatingMap.clear();
    isProcessingPayoutMap.clear();
    console.log("[EvaluationPayoutService] Polling stopped.");
}