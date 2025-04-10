// services/recallService.ts (Restructured Keys, No Overwrite, Clearer Logs)
import config from '../config';
import { QuestionData, AnswerData, EvaluationResult, PayoutStatusData, RequestStatus, JobStatus, RecallEventType } from '../types'; // Added RecallEventType back for internal use if needed later
import { testnet } from '@recallnet/chains';
import {
    createWalletClient, http, parseEther, formatEther, WalletClient, PublicClient, createPublicClient,
    BaseError, Address, ContractFunctionExecutionError, getAddress, parseGwei, formatGwei
} from 'viem';
import { privateKeyToAccount, Account } from 'viem/accounts';
import { truncateText } from '../utils';

// --- Dynamic Import ---
let RecallClientModule: any = null;
async function loadRecallClientModule() {
    if (!RecallClientModule) {
        console.log("[Recall Service] Dynamically importing @recallnet/sdk/client...");
        RecallClientModule = await import('@recallnet/sdk/client');
        console.log("[Recall Service] SDK Client module loaded.");
    }
    return RecallClientModule.RecallClient;
}

// --- Module State ---
let recallClientInstance: any = null;
let isRecallInitialized = false;
let initPromise: Promise<any> | null = null;
const RECALL_BUCKET_ALIAS = 'kintask-log-bucket-v1';
let logBucketAddress: Address | null = config.recallLogBucket ? getAddress(config.recallLogBucket) : null;
let account: Account | null = null;
let isProcessingTx = false;
const txQueue: Array<() => Promise<any>> = [];

// --- Constants & Prefixes (Updated) ---
const MAX_RPC_RETRIES = 100;
const RETRY_DELAY_MS = 1500;
// Base prefix for all data related to a request context
const CONTEXT_DATA_PREFIX = "reqs/"; // Changed prefix

const getQuestionKey = (ctx: string) => `${CONTEXT_DATA_PREFIX}${ctx}/question.json`;
const getAnswerKey = (ctx: string, agentId: Address) => `${CONTEXT_DATA_PREFIX}${ctx}/answers/${agentId}.json`; // Answers nested inside context
const getEvaluationKey = (ctx: string) => `${CONTEXT_DATA_PREFIX}${ctx}/evaluation.json`;
const getPayoutKey = (ctx: string) => `${CONTEXT_DATA_PREFIX}${ctx}/payout.json`;
const getAnswersPrefix = (ctx: string) => `${CONTEXT_DATA_PREFIX}${ctx}/answers/`; // Prefix for listing answers within contextswers/`; // Prefix for listing answers within context
const getAnswerEvidenceKey = (ctx: string, agentId: Address) => `${CONTEXT_DATA_PREFIX}${ctx}/answers/${agentId}_evidence.json`;

// --- Gas Settings ---
const MAX_ACCEPTABLE_PRIORITY_FEE_GWEI = '10';
const MAX_ACCEPTABLE_PRIORITY_FEE_WEI = parseGwei(MAX_ACCEPTABLE_PRIORITY_FEE_GWEI);
// *** Gas Limit - Needs Tuning based on network conditions and data size ***
// Start higher, potentially lower later if consistently successful at lower values.
// 200k was too low, causing estimation failures. Try 3M as a starting point.
const MANUAL_GAS_LIMIT = 200_000n;
console.log(`[Recall Service] Max acceptable priority fee set to: ${MAX_ACCEPTABLE_PRIORITY_FEE_GWEI} Gwei`);
console.log(`[Recall Service] Manual Gas Limit set to: ${MANUAL_GAS_LIMIT.toString()}`);


// --- Helpers ---
export function initializeAccount(): Account {
    if (account) return account;
    const privateKey = config.recallPrivateKey;
    if (!privateKey) { throw new Error('No RECALL_PRIVATE_KEY found.'); }
    const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey as `0x${string}` : `0x${privateKey}` as `0x${string}`;
    account = privateKeyToAccount(formattedPrivateKey);
    console.log(`[Recall Service] Initialized Wallet Account: ${account.address} | Chain: ${testnet.id}`);
    return account;
}

function getRecallWalletClient(): WalletClient {
    const acc = initializeAccount();
    return createWalletClient({ account: acc, chain: testnet, transport: http() });
}

function getPublicClient(): PublicClient {
    return createPublicClient({ chain: testnet, transport: http() });
}

export async function getRecallClient(): Promise<any> {
    if (recallClientInstance && isRecallInitialized) { return recallClientInstance; }
    if (initPromise) { return initPromise; }
    initPromise = (async () => {
        console.log('[Recall Service] Initializing dynamic RecallClient...');
        try {
            initializeAccount();
            const RecallClient = await loadRecallClientModule();
            const walletClient = getRecallWalletClient();
            const client = new RecallClient({ walletClient });
            if (!client.walletClient.account?.address) { throw new Error('No wallet address post-init.'); }
            console.log('[Recall Service] RecallClient initialized successfully.');
            recallClientInstance = client; isRecallInitialized = true; initPromise = null;
            return client;
        } catch (err: any) {
            const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
            console.error('[Recall Service] FATAL: Init RecallClient failed:', msg, err);
            recallClientInstance = null; isRecallInitialized = false; initPromise = null;
            throw new Error(`Recall Client init failed: ${msg}`);
        }
    })();
    return initPromise;
}

async function processTxQueue<T>(txFunction: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        const runTx = async () => {
            if (isProcessingTx) { txQueue.push(runTx); return; }
            isProcessingTx = true;
            try { const result = await txFunction(); resolve(result); }
            catch (err: any) {
                let errMsg = 'Unknown tx error';
                if (err instanceof BaseError) errMsg = err.shortMessage || err.message.split('\n')[0];
                else if (err instanceof Error) errMsg = err.message.split('\n')[0];
                else errMsg = String(err);
                console.error(`[Recall Tx Queue] Tx error: ${errMsg}`); reject(err);
            } finally { isProcessingTx = false; const nextTx = txQueue.shift(); if (nextTx) { setImmediate(() => { nextTx().catch(qErr => console.error("[Recall Tx Queue] Subsequent tx error:", qErr)); }); } }
        };
        if (!isProcessingTx && txQueue.length === 0) { runTx(); } else { txQueue.push(runTx); }
    });
}

export async function findLogBucketAddressOrFail(recall: any): Promise<Address> {
    if (logBucketAddress) { return logBucketAddress; }
    console.log(`[Recall Service] Finding bucket by alias: ${RECALL_BUCKET_ALIAS}...`);
    const bucketManager = recall.bucketManager();
    try {
        const { result: listRes } = await bucketManager.list();
        const allBuckets = listRes?.buckets ?? [];
        for (const b of allBuckets) {
            try { const metaRes = await bucketManager.getMetadata(b); if (metaRes.result?.metadata?.alias === RECALL_BUCKET_ALIAS) { const foundAddr = getAddress(b); console.log('[Recall Service] Found log bucket by alias:', foundAddr); logBucketAddress = foundAddr; return foundAddr; } } catch { /* ignore */ }
        }
    } catch (listError: any) { console.warn("[Recall Service] Error listing buckets:", listError.message); }
    throw new Error(`Log bucket '${RECALL_BUCKET_ALIAS}' not found.`);
}

async function checkAndBuyRecallCreditsIfNeeded(recall: any): Promise<void> {
    const creditManager = recall.creditManager();
    const { result: creditBalance } = await creditManager.getCreditBalance();
    const creditFree = creditBalance?.creditFree ?? 0n;
    console.log(`[Recall Service] Recall Credit Balance: ${formatEther(creditFree)} RTC`);
    if (creditFree === 0n) {
        console.log('[Recall Service] Buying 1 RTC credit...');
        try {
            const txHash = await processTxQueue(async () => { const { meta } = await creditManager.buy(parseEther("1")); return meta?.tx?.transactionHash; });
            if (!txHash) throw new Error('No tx hash returned.'); console.log('RTC purchase tx sent:', txHash); await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (buyError: any) { console.error(`[Recall Service] FAILED buy RTC: ${buyError.message}.`); throw new Error(`Failed ensure RTC balance: ${buyError.message}`); }
    }
}

/**
 * Core function to add object. Checks balance/gas. **Never overwrites.**
 * Includes pre-check for key existence. Exported for direct use if needed.
 */
export async function addObjectToBucket(
    dataObject: object,
    key: string
): Promise<{ success: boolean, bucket?: Address, key?: string, txHash?: string, error?: string, gasPriceTooHigh?: boolean, keyExists?: boolean }> {
    let recall: any; let bucketAddr: Address;
    const currentAccount = initializeAccount();
    const publicClient = getPublicClient();

    try { // Setup Phase
        recall = await getRecallClient();
        bucketAddr = await findLogBucketAddressOrFail(recall);
        const balance = await publicClient.getBalance({ address: currentAccount.address });
        console.log(`[Recall Service - addObj] Native Balance ${currentAccount.address}: ${formatEther(balance)}`);
        await checkAndBuyRecallCreditsIfNeeded(recall);
    } catch (setupError: any) { const errMsg = setupError?.message?.split('\n')[0] || String(setupError); console.error(`[Recall Setup Error - addObj] Key ${key}:`, errMsg); return { success: false, error: `Setup failed: ${errMsg}`, key }; }

    const contentStr = JSON.stringify(dataObject, null, 2);
    const fileBuffer = Buffer.from(contentStr, 'utf8');
    const bucketManager = recall.bucketManager();

    // --- Key Existence Pre-Check ---
    try {
        console.log(`[Recall Service - addObj] Checking existence for key: ${key}`);
        const { result: existingObject } = await bucketManager.get(bucketAddr, key);
        if (existingObject) { console.warn(`[Recall Service - addObj] Key already exists: ${key}. Skipping add.`); return { success: false, keyExists: true, error: `Key already exists: ${key}`, key }; }
    } catch (getError: any) {
        if (!getError.message?.includes('Not Found') && !getError.message?.includes('object not found')) { console.error(`[Recall Service - addObj] Error checking key existence for ${key}:`, getError.message); return { success: false, error: `Error checking key: ${getError.message}`, key }; }
        console.log(`[Recall Service - addObj] Key check confirmed non-existence.`);
    }

    // --- Transaction Attempt (No Overwrite) ---
    for (let attempt = 1; attempt <= MAX_RPC_RETRIES; attempt++) {
        try {
            console.log(`[Recall Service] Attempt ${attempt}/${MAX_RPC_RETRIES} to add object | Key: ${key}`);
            const txHash = await processTxQueue(async () => {
                console.log(`[Recall Tx Queue] Checking gas fees...`);
                const feeEstimate = await publicClient!.estimateFeesPerGas();
                const currentMaxPriorityFee = feeEstimate.maxPriorityFeePerGas ?? 0n;
                console.log(`[Recall Tx Queue] Est. Priority Fee: ${formatGwei(currentMaxPriorityFee)} Gwei`);
                if (currentMaxPriorityFee > MAX_ACCEPTABLE_PRIORITY_FEE_WEI) { const errorMsg = `Gas price too high (${formatGwei(currentMaxPriorityFee)} > ${MAX_ACCEPTABLE_PRIORITY_FEE_GWEI} Gwei)`; console.warn(`[Recall Tx Queue] ${errorMsg}. Aborting for key ${key}.`); throw new Error(`GAS_PRICE_TOO_HIGH: ${errorMsg}`); }
                console.log(`[Recall Tx Queue] Gas price ok. Proceeding with add tx...`);
                const balanceBefore = await publicClient!.getBalance({ address: currentAccount.address }); console.log(`[Recall Tx Queue] Native Balance pre-tx: ${formatEther(balanceBefore)}`);
                const callOptions: { gas?: bigint } = { gas: MANUAL_GAS_LIMIT };
                const { meta } = await bucketManager.add(bucketAddr, key, fileBuffer, callOptions);
                return meta?.tx?.transactionHash;
            });
            if (!txHash) { console.warn(`[Recall Service] AddObject for key ${key} (Attempt ${attempt}) no txHash.`); return { success: true, bucket: bucketAddr, key }; }
            console.log(`[Recall Service] Object added (Attempt ${attempt}). Key=${key.split('/').pop()}, Tx=${txHash.slice(0, 12)}...`);
            return { success: true, bucket: bucketAddr, key, txHash }; // Success!
        } catch (err: any) {
            let conciseError = `Attempt ${attempt} failed adding object (key=${truncateText(key, 30)})`; let isRetryable = true; let isGasError = false; let isGasPriceError = false;
            if (err instanceof Error && err.message.startsWith('GAS_PRICE_TOO_HIGH:')) { conciseError = err.message; isGasPriceError = true; isRetryable = false; console.warn(`[Recall Service] Tx deferred (high gas price) key ${key}`); }
            else if (err instanceof BaseError) { conciseError = `Attempt ${attempt}: ${err.shortMessage || err.message.split('\n')[0]}`; const detailedMessage = err.message?.toLowerCase() || ''; if (detailedMessage.includes('key exists')) { console.error(`[Recall Service] >> UNEXPECTED KEY EXISTS (Attempt ${attempt}) key ${key}. Pre-check failed?`); isRetryable = false; } else if (detailedMessage.includes('out of gas')) { console.error(`[Recall Service] >> OUT OF GAS (Attempt ${attempt}) key ${key}. Limit: ${MANUAL_GAS_LIMIT}.`); isRetryable = false; isGasError = true; } else if (detailedMessage.includes('actor balance') && detailedMessage.includes('less than needed')) { console.error(`[Recall Service] >> INSUFFICIENT NATIVE GAS BALANCE (Attempt ${attempt}) key ${key}`); isRetryable = false; isGasError = true; } else if (err.name === 'HttpRequestError' || conciseError.includes('RPC Request failed') || conciseError.includes('nonce') || conciseError.includes('timeout')) { isRetryable = true; } else { isRetryable = false; } console.error(`[Recall Service] AddObject Viem Error (Attempt ${attempt})`, { key, name: err.name }); }
            else if (err instanceof Error) { conciseError = `Attempt ${attempt}: ${err.message.split('\n')[0]}`; console.error(`[Recall Service] AddObject Generic Error (Attempt ${attempt})`, { key, name: err.name }); isRetryable = true; }
            else { conciseError = `Attempt ${attempt}: ${String(err)}`; console.error(`[Recall Service] AddObject Unknown Error (Attempt ${attempt})`, { key, error: err }); isRetryable = true; }
            if (!isGasPriceError) { console.error(`[Recall Service] addObjectToBucket error (Attempt ${attempt}): ${conciseError}`); }
            if (isRetryable && attempt < MAX_RPC_RETRIES) { const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1); console.log(`[Recall Service] Retrying add key ${key} in ${delay / 1000}s...`); await new Promise(resolve => setTimeout(resolve, delay)); }
            else { if (isGasError) conciseError = `Insufficient native gas or gas limit too low after ${attempt} attempts. Wallet: ${currentAccount.address}. Limit: ${MANUAL_GAS_LIMIT}`; else if (isGasPriceError) conciseError = `Gas price too high after ${attempt} attempts. Threshold: ${MAX_ACCEPTABLE_PRIORITY_FEE_GWEI} Gwei.`; else conciseError = `Failed adding object after ${attempt} attempts: ${conciseError}`; console.error(`[Recall Service] addObjectToBucket failed permanently key ${key}. Error: ${conciseError}`); return { success: false, error: conciseError, key: key, gasPriceTooHigh: isGasPriceError }; }
        }
    }
    return { success: false, error: `addObjectToBucket did not execute after ${MAX_RPC_RETRIES} attempts`, key: key };
}

// --- Logging Functions (Using New Structure, No Overwrite) ---

// Wrapper to handle results consistently with clearer log messages
async function handleLogResult(
    logType: 'Question' | 'Answer' | 'Evaluation' | 'Payout' | 'AnswerEvidence', // Added 'AnswerEvidence'
    context: string,
    agentId: string | null, // agentId only relevant for Answer type
    result: Awaited<ReturnType<typeof addObjectToBucket>>
): Promise<string | undefined> {
    const agentStr = agentId ? ` | Agt: ${agentId.substring(0, 10)}...` : ''; // Include agent only if provided
    const shortCtx = context.substring(0, 10); // Show context ID

    if (result.success) {
        console.log(`[Recall Service] Logged ${logType} OK | Ctx: ${shortCtx}${agentStr} | Key: ${result.key}`);
        return result.key || result.txHash;
    } else if (result.keyExists) {
        // Warning for existing keys is important
        console.warn(`[Recall Service] Log ${logType} SKIPPED (Key Exists) | Ctx: ${shortCtx}${agentStr} | Key: ${result.key}`);
    } else if (result.gasPriceTooHigh) {
        // Warning for gas price issues
        console.warn(`[Recall Service] Log ${logType} DEFERRED (Gas Price) | Ctx: ${shortCtx}${agentStr} | Key: ${result.key}`);
    } else {
        // Error for other failures
        console.error(`[Recall Service] Log ${logType} FAILED | Ctx: ${shortCtx}${agentStr} | Error: ${result.error || 'Unknown failure'} | Key: ${result.key}`);
    }
    return undefined; // Indicate failure, skip, or deferral
}

// *** New Function to Log Answer Evidence Metadata ***
/** Log metadata about the generated evidence CAR for a specific answer. */
export async function logAnswerEvidence(
    metadata: {
        requestContext: string;
        answeringAgentId: string; // The agent this evidence belongs to
        answerKey: string; // Key to the actual answer text
        evidenceDataCid: string;
        evidenceCarSize: number;
        evidencePieceCid: string; // Simulated
        evidencePieceSize: number; // Simulated
        evidenceCarUrl?: string; // Simulated URL (optional)
        submittedDealId: bigint | number; // Placeholder or real deal ID
        submissionTxHash: string; // Tx hash of the successful submitVerifiedEvaluation call
        timestamp?: string; // Optional timestamp
    },
): Promise<string | undefined> {
    const agentAddr = getAddress(metadata.answeringAgentId);
    const requestContext = metadata.requestContext;
    const key = getAnswerEvidenceKey(requestContext, agentAddr); // Use new helper
    const dataToLog = {
        ...metadata,
        submittedDealId: metadata.submittedDealId.toString(), // Store BigInt as string
        timestamp: metadata.timestamp || new Date().toISOString()
    };
    const result = await addObjectToBucket(dataToLog, key);
    return handleLogResult('AnswerEvidence', requestContext, agentAddr, result);
}


/** Log the initial question. */
export async function logQuestion(question: string, cid: string, requestContext: string): Promise<string | undefined> {
    // Uses: /reqs/{requestContext}/question.json
    const key = getQuestionKey(requestContext);
    const data: QuestionData = { question, cid, status: 'PendingAnswer', timestamp: new Date().toISOString(), requestContext };
    // Call addObjectToBucket (no overwrite)
    const result = await addObjectToBucket(data, key);
    // Pass null for agentId as it's not relevant here
    return handleLogResult('Question', requestContext, null, result);
}

/** Log an individual agent's answer. */
export async function logAnswer(answer: string, answeringAgentId: string, requestContext: string): Promise<string | undefined> {
    const agentAddr = getAddress(answeringAgentId); // Ensure checksum address
    // Uses: /reqs/{requestContext}/answers/{agentId}.json
    const key = getAnswerKey(requestContext, agentAddr);
    const data: AnswerData = { answer, answeringAgentId: agentAddr, status: 'Submitted', timestamp: new Date().toISOString(), requestContext };
    // Call addObjectToBucket (no overwrite)
    const result = await addObjectToBucket(data, key);
    // Pass the agentAddr for logging context
    return handleLogResult('Answer', requestContext, agentAddr, result);
}

/** Log the single evaluation summary for a context. */
export async function logEvaluationResult(evaluationData: EvaluationResult, requestContext: string): Promise<string | undefined> {
    // Uses: /reqs/{requestContext}/evaluation.json
    const key = getEvaluationKey(requestContext);
    // Create summary object to log
    const dataToLog = {
        evaluatorAgentId: evaluationData.evaluatorAgentId,
        timestamp: evaluationData.timestamp || new Date().toISOString(),
        requestContext: requestContext,
        status: evaluationData.status,
        answerCount: evaluationData.results.length,
        correctCount: evaluationData.results.filter(r => r.evaluation === 'Correct').length
        // Add other summarized fields if needed
    };
    // Call addObjectToBucket (no overwrite)
    const result = await addObjectToBucket(dataToLog, key);
    // Pass null for agentId
    return handleLogResult('Evaluation', requestContext, null, result);
}

/** Log the single payout summary for a context. */
export async function logPayoutStatus(payoutStatusData: PayoutStatusData, requestContext: string): Promise<string | undefined> {
    // Uses: /reqs/{requestContext}/payout.json
    const key = getPayoutKey(requestContext);
    // Create summary object to log
    const dataToLog = {
        payoutAgentId: payoutStatusData.payoutAgentId,
        payoutTimestamp: payoutStatusData.payoutTimestamp || new Date().toISOString(),
        requestContext: requestContext,
        success: payoutStatusData.success,
        message: truncateText(payoutStatusData.message, 200),
        txHashCount: Object.keys(payoutStatusData.txHashes || {}).length
        // Add other summarized fields if needed
    };
    // Call addObjectToBucket (no overwrite)
    const result = await addObjectToBucket(dataToLog, key);
    // Pass null for agentId
    return handleLogResult('Payout', requestContext, null, result);
}
// --- Function for Fetching Status (Adapted for New Structure) ---
export async function getRequestStatus(requestContext: string): Promise<RequestStatus | null> {
    let recall: any; let bucketAddr: Address;
    try { recall = await getRecallClient(); bucketAddr = await findLogBucketAddressOrFail(recall); }
    catch (initError: any) { console.error('[Recall Service] getRequestStatus init error:', initError.message); return null; }

    const questionKey = getQuestionKey(requestContext);
    const evaluationKey = getEvaluationKey(requestContext);
    const payoutKey = getPayoutKey(requestContext);
    const answerPrefix = getAnswersPrefix(requestContext);

    async function fetchObject<T>(key: string): Promise<T | null> { /* ... no change needed ... */
        try { const { result: objectBuf } = await recall.bucketManager().get(bucketAddr, key); if (!objectBuf) return null; return JSON.parse(Buffer.from(objectBuf).toString('utf8')) as T; }
        catch (error: any) { if (!error.message?.includes('Not Found') && !error.message?.includes('object not found')) console.warn(`[Recall Service] Fetch error key ${key}:`, error.message?.substring(0, 100)); return null; }
    }
    async function checkAnswersExist(prefix: string): Promise<boolean> { /* ... no change needed ... */
        try { const { result } = await recall.bucketManager().query(bucketAddr, { prefix, limit: 1 }); return (result?.objects?.length > 0); }
        catch (error: any) { console.warn(`[Recall Service] Error querying prefix ${prefix}:`, error.message); return false; }
    }

    try {
        const [questionData, evaluationData, payoutData, hasAnswers] = await Promise.all([
            fetchObject<QuestionData>(questionKey),
            fetchObject<EvaluationResult>(evaluationKey),
            fetchObject<PayoutStatusData>(payoutKey),
            checkAnswersExist(answerPrefix)
        ]);

        if (!questionData) { return null; }

        let overallStatus: JobStatus = 'PendingAnswer'; let errorMessage: string | undefined = undefined;

        if (payoutData) { overallStatus = payoutData.success ? 'PayoutComplete' : 'Error'; if (!payoutData.success) errorMessage = payoutData.message || 'Payout failed.'; }
        else if (evaluationData) { const evalStatus = evaluationData.status; if (evalStatus === 'PendingPayout' || evalStatus === 'PayoutComplete' || evalStatus === 'Error' || evalStatus === 'NoValidAnswers') { overallStatus = evalStatus; if (evalStatus === 'Error') errorMessage = 'Evaluation resulted in error.'; } else { overallStatus = 'Error'; errorMessage = `Unexpected evaluation status: ${evalStatus}`; console.warn(`[Recall Service] ${errorMessage} for ${requestContext}`); } }
        else if (hasAnswers) { overallStatus = 'PendingEvaluation'; }

        const statusResult: RequestStatus = { requestContext: requestContext, status: overallStatus, question: questionData.question, cid: questionData.cid, submittedAt: questionData.timestamp, hasAnswers: hasAnswers, evaluationStatus: evaluationData?.status, payoutStatus: payoutData?.success, payoutMessage: payoutData?.message, error: errorMessage, };
        return statusResult;
    } catch (error: any) { console.error(`[Recall Service] Unexpected error fetching status for ${requestContext}:`, error); return { requestContext: requestContext, status: 'Error', error: 'Internal error during status retrieval.', submittedAt: new Date().toISOString() }; }
}


// --- Polling Function (Returns only question keys) ---
export async function getPendingJobs(prefix: string): Promise<{ key: string }[]> {
    let recall: any; let bucketAddr: Address;
    try { recall = await getRecallClient(); bucketAddr = await findLogBucketAddressOrFail(recall); }
    catch (initError: any) { console.error(`[Recall Service] getPendingJobs init error prefix ${prefix}:`, initError.message); return []; }
    try {
        const bucketManager = recall.bucketManager();
        // Ensure we only query for the top-level question prefix
        const queryPrefix = CONTEXT_DATA_PREFIX;
        console.log(`[Recall Service] Querying job keys with prefix: '${queryPrefix}' (non-recursive)`);
        const { result } = await bucketManager.query(bucketAddr, { prefix: queryPrefix, delimiter: '' });
        const objectInfos = (result?.objects ?? []);
        // Filter specifically for the question.json files
        const questionJobKeys = objectInfos
            .map((o: any) => o.key)
            .filter((k: string | undefined): k is string => typeof k === 'string' && k.startsWith(queryPrefix) && k.endsWith('/question.json'));

        console.log(`[Recall Service] Found ${questionJobKeys.length} potential question job files.`);
        if (!questionJobKeys.length) { return []; }
        return questionJobKeys.map((key: string) => ({ key }));

    } catch (error: any) { console.error(`[Recall Service] Error polling jobs prefix ${prefix}:`, error.message); return []; }
}


// --- Helper to fetch object data ---
export async function getObjectData<T>(key: string): Promise<T | null> {
    let recall: any; let bucketAddr: Address;
    try { recall = await getRecallClient(); bucketAddr = await findLogBucketAddressOrFail(recall); const { result: objectBuf } = await recall.bucketManager().get(bucketAddr, key); if (!objectBuf) return null; return JSON.parse(Buffer.from(objectBuf).toString('utf8')) as T; }
    catch (error: any) { if (!error.message?.includes('Not Found') && !error.message?.includes('object not found')) { console.error(`[Recall Service] Error fetching object data key ${key}:`, error.message); } return null; }
}

// --- Function to Delete Object ---
export async function deleteObject(key: string): Promise<boolean> {
    let recall: any; let bucketAddr: Address;
    try { recall = await getRecallClient(); bucketAddr = await findLogBucketAddressOrFail(recall); await recall.bucketManager().delete(bucketAddr, key); console.log(`[Recall Service] Deleted object: ${key}`); return true; }
    catch (error: any) { if (!error.message?.includes('Not Found')) { console.error(`[Recall Service] Error deleting object ${key}:`, error.message); } return false; }
}

// ==== ./services/recallService.ts ====