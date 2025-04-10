// src/services/evaluationPayoutService.ts

import config from '../config';
// Import necessary types
import {
    QuestionData,
    AnswerData,
    EvaluationResult,
    JobStatus,
    PayoutStatusData,
} from '../types';
// Import services
import {
    logEvaluationResult as recallLogEvaluationResult,
    logPayoutStatus as recallLogPayoutStatus,
    getObjectData,
    findLogBucketAddressOrFail,
    getRecallClient,
    getPendingJobs,
    initializeAccount,
    deleteObject,
} from './recallService'; // Import from the MODIFIED recallService
import { fetchContentByCid } from './filecoinService';
import { evaluateAnswerWithLLM, LLMEvaluationResult } from './generatorService';
import {
    registerAgent,
    submitVerificationResult,
    triggerAggregation,
} from './fvmContractService';
import { getAddress, Address, isAddress } from 'viem';
import { truncateText } from '../utils';

// --- Configuration ---
const EVALUATION_POLLING_INTERVAL_MS = 45000;
const PAYOUT_POLLING_INTERVAL_MS = 120000;

let BACKEND_EVALUATOR_ID: Address = "0xBackendEvaluatorPlaceholder";
try {
    const backendAccount = initializeAccount();
    BACKEND_EVALUATOR_ID = backendAccount.address;
    console.log(`[EvaluationPayoutService] Using Backend Evaluator/Payout ID: ${BACKEND_EVALUATOR_ID}`);
} catch (e: any) {
    console.error("[EvaluationPayoutService] ERROR: Could not derive backend agent ID.", e.message);
}

// --- Prefixes and Keys ---
const CONTEXT_DATA_PREFIX = "reqs/";
const getQuestionKey = (ctx: string) => `${CONTEXT_DATA_PREFIX}${ctx}/question.json`;
const getAnswersPrefix = (ctx: string) => `${CONTEXT_DATA_PREFIX}${ctx}/answers/`;
const getEvaluationKey = (ctx: string) => `${CONTEXT_DATA_PREFIX}${ctx}/evaluation.json`;
const getPayoutKey = (ctx: string) => `${CONTEXT_DATA_PREFIX}${ctx}/payout.json`;

// --- Agent Payout Addresses ---
const agentPayoutAddresses: Record<Address, Address | undefined> = {
    [getAddress("0xe6272C7fBF8696d269c3d37c18AFA112ADeD9ac7")]: getAddress("0x25D40008ffC27D95D506224a246916d7E7ac0f36"),
};

if (Object.keys(agentPayoutAddresses).length === 0)
    console.warn("[EvaluationPayoutService] WARNING: Agent Payout Address mapping is empty!");
else
    console.log("[EvaluationPayoutService] Loaded Agent Payout Address Mappings:", agentPayoutAddresses);

// --- State ---
let evaluationPollTimer: NodeJS.Timeout | null = null;
let payoutPollTimer: NodeJS.Timeout | null = null;
let isShuttingDown = false;
let isEvaluatingMap = new Map<string, boolean>();
let isProcessingPayoutMap = new Map<string, boolean>();

// --- Helper Functions ---
async function getQuestionAndContent(
    requestContext: string
): Promise<{ questionData: QuestionData | null; content: string | null }> {
    const questionKey = getQuestionKey(requestContext);
    const questionData = await getObjectData<QuestionData>(questionKey);
    if (!questionData?.cid || !questionData?.question) {
        console.warn(`[EvalPay DEBUG] getQnC: Q data missing/invalid | Ctx: ${requestContext}, Key: ${questionKey}`);
        return { questionData: null, content: null };
    }
    const content = await fetchContentByCid(questionData.cid);
    if (!content) {
        console.warn(`[EvalPay DEBUG] getQnC: Failed fetch KB | Ctx: ${requestContext} (CID: ${questionData.cid})`);
        return { questionData, content: null };
    }
    console.log(`[EvalPay DEBUG] getQnC: OK Ctx: ${requestContext}`);
    return { questionData, content };
}

/**
 * Create final payout log for terminal evaluation states (NoValidAnswers, Error)
 */
async function finalizePayoutLog(
    requestContext: string,
    evaluationStatus: 'NoValidAnswers' | 'Error'
): Promise<void> {
    const shortCtx = requestContext.substring(0, 10);
    console.log(
        `[EvalPay DEBUG] Finalizing payout log for Ctx: ${shortCtx} due to Eval Status: ${evaluationStatus}`
    );
    const payoutStatus: PayoutStatusData = {
        requestContext,
        stage: `FinalizedFrom${evaluationStatus}`,
        success: false, // Not a successful payout scenario
        message:
            evaluationStatus === 'NoValidAnswers'
                ? 'No valid answers found during evaluation.'
                : 'Evaluation process resulted in an error.',
        processedAgents: 0, // N/A
        correctAnswers: 0,  // N/A
        submissionsSent: 0, // N/A
        fvmErrors: 0,       // N/A
        txHashes: {},
        payoutAgentId: BACKEND_EVALUATOR_ID,
        payoutTimestamp: new Date().toISOString(),
    };
    // Attempt to log this final status
    await recallLogPayoutStatus(payoutStatus, requestContext);
    console.log(`[EvalPay DEBUG] Final payout log attempt finished for Ctx: ${shortCtx}`);
}

/** Evaluates answers */
async function evaluateAnswers(requestContext: string): Promise<void> {
    const shortCtx = requestContext.substring(0, 10);
    if (isEvaluatingMap.get(requestContext)) {
        console.log(`[EvalPay DEBUG] evaluateAnswers: Eval in progress | Ctx: ${shortCtx}. Skip.`);
        return;
    }
    isEvaluatingMap.set(requestContext, true);
    console.log(`[EvalPay DEBUG] ===> ENTER evaluateAnswers | Ctx: ${shortCtx}`);

    const evaluationOutput: EvaluationResult = {
        requestContext: requestContext,
        results: [],
        status: 'Error',
        evaluatorAgentId: BACKEND_EVALUATOR_ID,
        timestamp: new Date().toISOString(),
    };

    try {
        console.log(`[EvalPay DEBUG] evaluateAnswers: Check existing eval log | Ctx: ${shortCtx}`);
        const existingEval = await getObjectData(getEvaluationKey(requestContext));
        if (existingEval) {
            console.log(`[EvalPay DEBUG] evaluateAnswers: Eval log EXISTS | Ctx: ${shortCtx}. Skip evaluation.`);
            isEvaluatingMap.delete(requestContext);
            return;
        }
        console.log(`[EvalPay DEBUG] evaluateAnswers: No existing eval log | Ctx: ${shortCtx}. Proceeding.`);

        const { questionData, content } = await getQuestionAndContent(requestContext);
        if (!questionData || !content) {
            throw new Error(`Missing question/content for ${shortCtx}`);
        }
        console.log(`[EvalPay DEBUG] evaluateAnswers: Got question/content | Ctx: ${shortCtx}`);

        const recall = await getRecallClient();
        const bucketAddr = await findLogBucketAddressOrFail(recall);
        const answerPrefix = getAnswersPrefix(requestContext);
        console.log(
            `[EvalPay DEBUG] evaluateAnswers: Querying answers | Ctx: ${shortCtx} | Prefix: ${answerPrefix}`
        );
        const { result: answersResult } = await recall.bucketManager().query(bucketAddr, { prefix: answerPrefix });
        const allAnswerKeys = (answersResult?.objects || [])
            .map((o: any) => o.key)
            .filter((k?: string): k is string => !!k && k.endsWith('.json'));
        console.log(
            `[EvalPay DEBUG] evaluateAnswers: Found ${allAnswerKeys.length} answer keys | Ctx: ${shortCtx}`
        );

        if (allAnswerKeys.length === 0) {
            console.warn(`[EvalPay DEBUG] evaluateAnswers: No answer files found | Ctx: ${shortCtx}`);
            evaluationOutput.status = 'NoValidAnswers';
            await recallLogEvaluationResult(evaluationOutput, requestContext);
            isEvaluatingMap.delete(requestContext);
            return;
        }

        const excerpt = truncateText(content, 3500);
        const evaluationPromises = allAnswerKeys.map(async (answerKey: string) => {
            const answerData = await getObjectData<AnswerData>(answerKey);
            if (!answerData?.answer || !answerData?.answeringAgentId) {
                console.warn(`[EvalPay DEBUG] Invalid answer data key ${answerKey}`);
                return null;
            }
            console.log(
                `[EvalPay DEBUG] Evaluating answer | Ctx: ${shortCtx} | Agent: ${answerData.answeringAgentId.substring(
                    0,
                    10
                )}...`
            );
            const evaluation: LLMEvaluationResult = await evaluateAnswerWithLLM(
                questionData.question,
                answerData.answer,
                excerpt,
                requestContext,
                BACKEND_EVALUATOR_ID
            );
            console.log(
                `[EvalPay DEBUG] LLM Eval Result | Ctx: ${shortCtx} | Agent: ${answerData.answeringAgentId.substring(
                    0,
                    10
                )}... | Verdict: ${evaluation.evaluation}`
            );
            return {
                answeringAgentId: answerData.answeringAgentId,
                answerKey,
                evaluation: evaluation.evaluation,
                confidence: evaluation.confidence,
                explanation: evaluation.explanation,
            };
        });
        const completedEvaluations = (await Promise.all(evaluationPromises)).filter(
            (e): e is EvaluationResult['results'][0] => e !== null
        );
        evaluationOutput.results = completedEvaluations;
        console.log(
            `[EvalPay DEBUG] evaluateAnswers: Completed ${completedEvaluations.length} evaluations | Ctx: ${shortCtx}`
        );

        if (evaluationOutput.results.length > 0) {
            const hasCorrect = evaluationOutput.results.some((r) => r.evaluation === 'Correct');
            evaluationOutput.status = hasCorrect ? 'PendingPayout' : 'NoValidAnswers';
        } else {
            evaluationOutput.status = 'NoValidAnswers';
        }
        console.log(
            `[EvalPay DEBUG] evaluateAnswers: Final status determined: ${evaluationOutput.status} | Ctx: ${shortCtx}`
        );
        console.log(
            `[EvalPay DEBUG] evaluateAnswers: Attempting log | Ctx: ${shortCtx} | Status: ${evaluationOutput.status}`
        );
        const logKey = await recallLogEvaluationResult(evaluationOutput, requestContext);
        console.log(
            `[EvalPay DEBUG] evaluateAnswers: Log attempt result (key/undefined): ${logKey} | Ctx: ${shortCtx}`
        );
    } catch (error: any) {
        const errorMessage = error.message || String(error);
        console.error(`[EvalPay DEBUG] evaluateAnswers: CATCH BLOCK | Ctx: ${shortCtx}: ${errorMessage}`);
        evaluationOutput.status = 'Error';
        try {
            console.log(`[EvalPay DEBUG] evaluateAnswers: Attempting log ERROR status | Ctx: ${shortCtx}`);
            await recallLogEvaluationResult(evaluationOutput, requestContext);
        } catch (logErr: any) {
            console.error(`[EvalPay DEBUG] evaluateAnswers: Failed log ERROR status: ${logErr.message}`);
        }
    } finally {
        isEvaluatingMap.delete(requestContext);
        console.log(
            `[EvalPay DEBUG] <=== EXIT evaluateAnswers | Ctx: ${shortCtx} | Final Status: ${evaluationOutput.status}`
        );
    }
}

/** Processes payout for PendingPayout status */
async function processPayout(evaluationData: EvaluationResult): Promise<void> {
    const requestContext = evaluationData.requestContext;
    const shortCtx = requestContext.substring(0, 10);
    if (isProcessingPayoutMap.get(requestContext)) {
        console.log(`[EvalPay DEBUG] processPayout: Payout already in progress | Ctx: ${shortCtx}. Skip.`);
        return;
    }
    isProcessingPayoutMap.set(requestContext, true);
    const logPrefix = `[Payout Ctx: ${shortCtx}]`;
    console.log(`[EvalPay DEBUG] ===> ENTER processPayout | Ctx: ${shortCtx}`);

    let payoutStatus: PayoutStatusData = {
        requestContext,
        stage: 'Start',
        success: false,
        message: 'Payout initiated.',
        processedAgents: 0,
        correctAnswers: 0,
        submissionsSent: 0,
        fvmErrors: 0,
        txHashes: {},
        payoutAgentId: BACKEND_EVALUATOR_ID,
        payoutTimestamp: new Date().toISOString(),
    };
    let fvmErrors = 0;

    try {
        console.log(`${logPrefix} Check existing payout log...`);
        const existingPayout = await getObjectData(getPayoutKey(requestContext));
        if (existingPayout) {
            console.log(`${logPrefix} Payout log EXISTS. Skip payout.`);
            isProcessingPayoutMap.delete(requestContext);
            return;
        }
        console.log(`${logPrefix} No existing payout log. Proceeding.`);
        console.log(`${logPrefix} Check evaluation status: ${evaluationData.status}`);
        if (evaluationData.status !== 'PendingPayout') {
            console.log(`${logPrefix} Eval status not PendingPayout. Skip payout.`);
            isProcessingPayoutMap.delete(requestContext);
            return;
        }

        payoutStatus.stage = 'FetchQuestionData';
        console.log(`${logPrefix} Fetching question data...`);
        const { questionData } = await getQuestionAndContent(requestContext);
        if (!questionData?.cid) {
            throw new Error("Missing question data/CID.");
        }
        const evidenceCid = questionData.cid;
        console.log(
            `${logPrefix} Got question data. Evidence CID: ${evidenceCid.substring(0, 10)}`
        );
        let submittedCount = 0;
        payoutStatus.correctAnswers = evaluationData.results.filter((r) => r.evaluation === 'Correct').length;
        payoutStatus.processedAgents = evaluationData.results.length;
        console.log(`${logPrefix} Processing ${payoutStatus.correctAnswers} correct answers.`);

        for (const result of evaluationData.results) {
            if (isShuttingDown) throw new Error('Shutdown signal');
            if (result.evaluation === 'Correct') {
                const answeringAgentId = result.answeringAgentId;
                console.log(`${logPrefix} Processing Correct answer Agent: ${answeringAgentId.substring(0, 10)}`);
                payoutStatus.stage = `ValidateAddress_${answeringAgentId.substring(0, 6)}`;
                if (!isAddress(answeringAgentId)) {
                    console.warn(`${logPrefix} Invalid Addr ${answeringAgentId}. Skip.`);
                    fvmErrors++;
                    continue;
                }
                const payoutAddress = getAddress(answeringAgentId);
                try {
                    payoutStatus.stage = `RegisterAgent_${payoutAddress.substring(0, 6)}`;
                    console.log(`${logPrefix} Registering Agent ${payoutAddress}...`);
                    const registerTx = await registerAgent(answeringAgentId, payoutAddress);
                    if (registerTx)
                        payoutStatus.txHashes[`register_${payoutAddress.substring(0, 6)}`] = registerTx;
                } catch (regError: any) {
                    console.error(`${logPrefix} Register FAIL ${answeringAgentId}:`, regError.message);
                    fvmErrors++;
                    continue;
                }
                try {
                    payoutStatus.stage = `SubmitResult_${payoutAddress.substring(0, 6)}`;
                    const confidence = result.confidence ?? 1.0;
                    const confidenceScaled = Math.max(0, Math.min(100, Math.round(confidence * 100)));
                    console.log(`${logPrefix} Submitting FVM Agent ${payoutAddress} Conf ${confidenceScaled}...`);
                    const submitTx = await submitVerificationResult(
                        requestContext,
                        answeringAgentId,
                        'Correct',
                        confidenceScaled,
                        evidenceCid
                    );
                    if (submitTx) {
                        payoutStatus.txHashes[`submit_${payoutAddress.substring(0, 6)}`] = submitTx;
                        submittedCount++;
                    } else {
                        console.error(`${logPrefix} Submit FAIL ${payoutAddress}.`);
                        fvmErrors++;
                    }
                } catch (submitError: any) {
                    console.error(`${logPrefix} Submit FAIL ${payoutAddress}:`, submitError.message);
                    fvmErrors++;
                }
            }
        }
        payoutStatus.submissionsSent = submittedCount;
        payoutStatus.fvmErrors = fvmErrors;
        console.log(`${logPrefix} FVM submissions done: ${submittedCount} sent, ${fvmErrors} errors.`);

        if (submittedCount > 0 && fvmErrors === 0) {
            try {
                payoutStatus.stage = `TriggerAggregation`;
                console.log(`${logPrefix} Triggering Aggregation...`);
                const aggregateTx = await triggerAggregation(requestContext);
                if (aggregateTx) {
                    payoutStatus.txHashes[`aggregate`] = aggregateTx;
                    payoutStatus.success = true;
                    payoutStatus.message = `Processed ${submittedCount}, triggered aggregation.`;
                } else {
                    payoutStatus.success = false;
                    payoutStatus.message = `Processed ${submittedCount}, FAILED trigger aggregation.`;
                }
            } catch (aggError: any) {
                payoutStatus.success = false;
                payoutStatus.message = `Error triggering aggregation: ${aggError.message}`;
                console.error(`${logPrefix} Aggregation Error:`, aggError.message);
            }
        } else if (fvmErrors > 0) {
            payoutStatus.success = false;
            payoutStatus.message = `Processed ${submittedCount}, ${fvmErrors} FVM errors. Aggregation skipped.`;
        } else {
            payoutStatus.success = true;
            payoutStatus.message = "No correct answers for payout.";
        }
        console.log(`${logPrefix} Aggregation outcome: Success=${payoutStatus.success}, Msg=${payoutStatus.message}`);
        console.log(`${logPrefix} Updating evaluation status to ${payoutStatus.success ? 'PayoutComplete' : 'Error'}...`);
        evaluationData.status = payoutStatus.success ? 'PayoutComplete' : 'Error';
        await recallLogEvaluationResult(evaluationData, requestContext);
    } catch (error: any) {
        const errorMessage = error.message || String(error);
        console.error(`${logPrefix} CATCH BLOCK: Unhandled payout error: ${errorMessage}`);
        payoutStatus.success = false;
        payoutStatus.message = errorMessage;
        payoutStatus.fvmErrors = fvmErrors;
        if (evaluationData && evaluationData.status !== 'Error') {
            try {
                evaluationData.status = 'Error';
                await recallLogEvaluationResult(evaluationData, requestContext);
            } catch {
                /* ignore */
            }
        }
    } finally {
        payoutStatus.payoutTimestamp = new Date().toISOString();
        console.log(`${logPrefix} Attempting final payout status log...`);
        await recallLogPayoutStatus(payoutStatus, requestContext);
        isProcessingPayoutMap.delete(requestContext);
        console.log(`[EvalPay DEBUG] <=== EXIT processPayout | Ctx: ${shortCtx} | Final Success: ${payoutStatus.success}`);
    }
}

/** Polling function for evaluations. */
async function pollForPendingEvaluations(): Promise<void> {
    const pollId = `EvalPoll-${Date.now() % 10000}`;
    if (isShuttingDown) return;
    if (Array.from(isEvaluatingMap.values()).some((status) => status === true)) {
        if (!isShuttingDown) {
            evaluationPollTimer = setTimeout(pollForPendingEvaluations, EVALUATION_POLLING_INTERVAL_MS);
        }
        return;
    }
    console.log(`[EvalPay DEBUG] === Starting ${pollId} Evaluation Check ===`);
    try {
        const questionJobs = await getPendingJobs(CONTEXT_DATA_PREFIX);
        console.log(`[EvalPay DEBUG - ${pollId}] Found ${questionJobs.length} potential question contexts.`);
        if (questionJobs.length > 0) {
            for (const jobInfo of questionJobs) {
                if (isShuttingDown) break;
                const contextMatch = jobInfo.key.match(/reqs\/(req_[^/]+)\/question\.json$/);
                const requestContext = contextMatch ? contextMatch[1] : null;
                if (!requestContext) {
                    console.warn(`[EvalPay DEBUG - ${pollId}] Skip: Could not extract context from key: ${jobInfo.key}`);
                    continue;
                }
                const shortCtx = requestContext.substring(0, 10);
                console.log(`[EvalPay DEBUG - ${pollId}] Checking context: ${shortCtx}`);
                if (isEvaluatingMap.get(requestContext)) {
                    console.log(`[EvalPay DEBUG - ${pollId}] Skip: Already evaluating Ctx: ${shortCtx}.`);
                    continue;
                }
                const evaluationKey = getEvaluationKey(requestContext);
                const payoutKey = getPayoutKey(requestContext);
                console.log(`[EvalPay DEBUG - ${pollId}] Checking existing logs for Ctx: ${shortCtx}`);
                const [existingEval, existingPayout] = await Promise.all([
                    getObjectData(evaluationKey),
                    getObjectData(payoutKey),
                ]);
                if (!existingEval && !existingPayout) {
                    console.log(
                        `[EvalPay DEBUG - ${pollId}] No eval/payout logs exist for Ctx: ${shortCtx}. Checking answers...`
                    );
                    const recall = await getRecallClient();
                    const bucketAddr = await findLogBucketAddressOrFail(recall);
                    const answerPrefix = getAnswersPrefix(requestContext);
                    const { result: answersResult } = await recall.bucketManager().query(bucketAddr, {
                        prefix: answerPrefix,
                        limit: 1,
                    });
                    const hasAnswers = answersResult?.objects?.length > 0;
                    console.log(`[EvalPay DEBUG - ${pollId}] Answer check for Ctx: ${shortCtx}. Found: ${hasAnswers}`);
                    if (hasAnswers) {
                        console.log(`[EvalPay DEBUG - ${pollId}] Triggering evaluateAnswers for Ctx: ${shortCtx}`);
                        evaluateAnswers(requestContext);
                    } else {
                        console.log(`[EvalPay DEBUG - ${pollId}] No answers yet for Ctx: ${shortCtx}.`);
                    }
                } else {
                    console.log(
                        `[EvalPay DEBUG - ${pollId}] Skip: Eval (${!!existingEval}) or Payout (${!!existingPayout}) exists for Ctx: ${shortCtx}.`
                    );
                }
            }
        }
        console.log(`[EvalPay DEBUG] === Finished ${pollId} Evaluation Check ===`);
    } catch (error: any) {
        console.error(`[EvalPay DEBUG - ${pollId}] Error during eval poll:`, error.message);
    } finally {
        if (!isShuttingDown) {
            evaluationPollTimer = setTimeout(pollForPendingEvaluations, EVALUATION_POLLING_INTERVAL_MS);
        }
    }
}

/** Polling function for payouts. (Handles NoValidAnswers/Error states) */
async function pollForPendingPayouts(): Promise<void> {
    const pollId = `PayoutPoll-${Date.now() % 10000}`;
    if (isShuttingDown) return;
    if (Array.from(isProcessingPayoutMap.values()).some((status) => status === true)) {
        if (!isShuttingDown) {
            payoutPollTimer = setTimeout(pollForPendingPayouts, PAYOUT_POLLING_INTERVAL_MS);
        }
        return;
    }
    console.log(`[EvalPay DEBUG] === Starting ${pollId} Payout Check ===`);

    try {
        const recall = await getRecallClient();
        const bucketAddr = await findLogBucketAddressOrFail(recall);
        console.log(`[EvalPay DEBUG - ${pollId}] Querying contexts with prefix: ${CONTEXT_DATA_PREFIX}`);
        const { result: contextListResult } = await recall.bucketManager().query(bucketAddr, {
            prefix: CONTEXT_DATA_PREFIX,
            delimiter: '/',
        });
        const contextPrefixes: string[] = [
            ...new Set((contextListResult?.commonPrefixes as string[] | undefined) || []),
        ];
        console.log(`[EvalPay DEBUG - ${pollId}] Found ${contextPrefixes.length} potential context prefixes.`);

        if (contextPrefixes.length > 0) {
            for (const contextPrefix of contextPrefixes) {
                if (isShuttingDown) break;
                const parts = contextPrefix.replace(/\/$/, '').split('/');
                const requestContext = parts.pop();
                if (!requestContext || !requestContext.startsWith('req_')) {
                    console.warn(`[EvalPay DEBUG - ${pollId}] Invalid context prefix: ${contextPrefix}`);
                    continue;
                }
                const shortCtx = requestContext.substring(0, 10);
                console.log(`[EvalPay DEBUG - ${pollId}] Checking context: ${shortCtx}`);

                if (isProcessingPayoutMap.get(requestContext)) {
                    console.log(`[EvalPay DEBUG - ${pollId}] Skip: Already processing payout Ctx: ${shortCtx}.`);
                    continue;
                }

                const payoutKey = getPayoutKey(requestContext);
                const existingPayout = await getObjectData(payoutKey);
                if (existingPayout) {
                    console.log(`[EvalPay DEBUG - ${pollId}] Skip: Payout log exists for Ctx: ${shortCtx}.`);
                    continue;
                }

                const evaluationKey = getEvaluationKey(requestContext);
                console.log(`[EvalPay DEBUG - ${pollId}] Fetching evaluation data: ${evaluationKey}`);
                const evaluationData = await getObjectData<EvaluationResult>(evaluationKey); // Fetch evaluation data

                if (!evaluationData) {
                    console.log(`[EvalPay DEBUG - ${pollId}] Skip: No evaluation data found for Ctx: ${shortCtx}.`);
                    continue; // Cannot proceed without evaluation data
                }

                // --- Handle based on evaluation status ---
                if (evaluationData.status === 'PendingPayout') {
                    console.log(
                        `[EvalPay DEBUG - ${pollId}] ✅ Found PendingPayout for Ctx: ${shortCtx}. Triggering processPayout...`
                    );
                    processPayout(evaluationData); // Fire and forget for concurrency
                } else if (
                    evaluationData.status === 'NoValidAnswers' ||
                    evaluationData.status === 'Error'
                ) {
                    console.log(
                        `[EvalPay DEBUG - ${pollId}]  Detected terminal evaluation status '${evaluationData.status}' for Ctx: ${shortCtx}. Triggering finalizePayoutLog...`
                    );
                    // Directly log the final payout status indicating no payout occurred
                    finalizePayoutLog(requestContext, evaluationData.status); // Fire and forget
                } else if (evaluationData.status === 'PayoutComplete') {
                    // This case should ideally be caught by the existingPayout check, but handle defensively
                    console.log(
                        `[EvalPay DEBUG - ${pollId}] Eval status already PayoutComplete for Ctx: ${shortCtx}. Ensure payout log exists or finalize.`
                    );
                    // Optionally call finalizePayoutLog if payout log is missing but eval is complete
                    // finalizePayoutLog(requestContext, 'Error'); // Log as error if payout log missing? Or ignore.
                } else {
                    // Log unexpected status, but don't error out the whole polling loop
                    console.warn(
                        `[EvalPay DEBUG - ${pollId}] Unexpected eval status '${evaluationData.status}' for Ctx: ${shortCtx}. Skip payout.`
                    );
                }
            }
        }
        console.log(`[EvalPay DEBUG] === Finished ${pollId} Payout Check ===`);
    } catch (error: any) {
        console.error(`[EvalPay DEBUG - ${pollId}] Error during payout poll:`, error.message);
    } finally {
        if (!isShuttingDown) {
            payoutPollTimer = setTimeout(pollForPendingPayouts, PAYOUT_POLLING_INTERVAL_MS);
        }
    }
}

// --- Service Start/Stop ---
export function startEvaluationPayoutService(): void {
    if (evaluationPollTimer || payoutPollTimer) {
        console.warn("[EvaluationPayoutService] Polling loops already started.");
        return;
    }
    isShuttingDown = false;
    console.log("[EvaluationPayoutService] Starting polling loops...");
    evaluationPollTimer = setTimeout(() => {
        if (!isShuttingDown) pollForPendingEvaluations();
    }, Math.random() * 1000);
    payoutPollTimer = setTimeout(() => {
        if (!isShuttingDown) pollForPendingPayouts();
    }, 5000 + Math.random() * 1000);
}

export function stopEvaluationPayoutService(): void {
    console.log("[EvaluationPayoutService] Stopping polling loops...");
    isShuttingDown = true;
    if (evaluationPollTimer) {
        clearTimeout(evaluationPollTimer);
        evaluationPollTimer = null;
    }
    if (payoutPollTimer) {
        clearTimeout(payoutPollTimer);
        payoutPollTimer = null;
    }
    isEvaluatingMap.clear();
    isProcessingPayoutMap.clear();
    console.log("[EvaluationPayoutService] Polling stopped.");
}

// ==== ./src/services/evaluationPayoutService.ts ====
