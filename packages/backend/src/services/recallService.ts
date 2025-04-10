// services/recallService.ts (LEAN Version + Gas Check + Manual Gas Limit + Overwrite Fixed)
import config from '../config';
import { QuestionData, AnswerData, VerdictData, RequestStatus, RecallLogEntryData, RecallEventType, VerificationResultInternal, EvaluationResult, JobStatus, PayoutStatusData } from '../types'; // Ensure all used types are imported
import { testnet } from '@recallnet/chains';
import {
    createWalletClient, http, parseEther, formatEther, WalletClient, PublicClient, createPublicClient,
    BaseError, Address, ContractFunctionExecutionError, getAddress, parseGwei, formatGwei // Import formatGwei directly from viem
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
    return RecallClientModule.RecallClient; // Return the specific class
}

// --- Module State ---
let recallClientInstance: any = null;
let isRecallInitialized = false;
let initPromise: Promise<any> | null = null;
const RECALL_BUCKET_ALIAS = 'kintask-log-bucket-v1';
let logBucketAddress: Address | null = config.recallLogBucket ? getAddress(config.recallLogBucket) : null; // Store checksummed if provided
let account: Account | null = null; // Ensure this is initialized reliably
let isProcessingTx = false;
const txQueue: Array<() => Promise<any>> = [];
// --- NO approvedBuckets cache in LEAN version ---

// --- Constants & Prefixes ---
const MAX_RPC_RETRIES = 100; // Restore retries
const RETRY_DELAY_MS = 1500;
const QUESTIONS_PREFIX = "questions/";
const ANSWERS_PREFIX = "answers/";
const VERDICTS_PREFIX = "verdicts/"; // For individual agent verdicts in consensus model
const EVALUATION_RECALL_PREFIX = "evaluation/"; // For evaluator agent results
const PAYOUT_RECALL_PREFIX = "payouts/"; // For payout agent results
const ERRORS_PREFIX = "errors/";
const FINAL_RESULTS_PREFIX = "final_results/"; // For final results/traces of sync flow
const TIMELOCK_REVEALS_PREFIX = "timelock_reveals/";

// --- Gas Settings ---
const MAX_ACCEPTABLE_PRIORITY_FEE_GWEI = '10'; // Example threshold
const MAX_ACCEPTABLE_PRIORITY_FEE_WEI = parseGwei(MAX_ACCEPTABLE_PRIORITY_FEE_GWEI);
// *** Define a Manual Gas Limit ***
// Tune this based on observed successful transactions or network recommendations.
const MANUAL_GAS_LIMIT = 2_000_000n; // Use BigInt (n suffix) - Example value
console.log(`[Recall Service] Max acceptable priority fee set to: ${MAX_ACCEPTABLE_PRIORITY_FEE_GWEI} Gwei`);
console.log(`[Recall Service] Manual Gas Limit set to: ${MANUAL_GAS_LIMIT.toString()}`);


// --- Helpers ---
/**
 * Initializes the Viem Account from the private key. Exported for use by other services/agents.
 */
export function initializeAccount(): Account { // Export initializeAccount
    if (account) return account;

    const privateKey = config.recallPrivateKey;
    if (!privateKey) {
        throw new Error('No RECALL_PRIVATE_KEY found in config.');
    }
    const formattedPrivateKey = privateKey.startsWith('0x')
        ? privateKey as `0x${string}`
        : `0x${privateKey}` as `0x${string}`;

    account = privateKeyToAccount(formattedPrivateKey);
    console.log(`[Recall Service] Initialized Wallet Account: ${account.address} | Chain: ${testnet.id}`);
    return account;
}

function getRecallWalletClient(): WalletClient {
    const acc = initializeAccount(); // Ensure account is initialized
    return createWalletClient({
        account: acc,
        chain: testnet,
        transport: http(),
    });
}

function getPublicClient(): PublicClient {
    // Initialize public client separately, doesn't need account info immediately
    return createPublicClient({
        chain: testnet,
        transport: http(),
    });
}

// Mark getRecallClient as exportable if evaluationPayoutService needs it
export async function getRecallClient(): Promise<any> { // Export getRecallClient
    if (recallClientInstance && isRecallInitialized) { return recallClientInstance; }
    if (initPromise) { return initPromise; }
    initPromise = (async () => {
        console.log('[Recall Service] Initializing dynamic RecallClient...');
        try {
            initializeAccount(); // Ensure account object exists before client init
            const RecallClient = await loadRecallClientModule();
            const walletClient = getRecallWalletClient(); // Creates client with initialized account
            const client = new RecallClient({ walletClient });
            if (!client.walletClient.account?.address) { throw new Error('No wallet address after RecallClient init.'); }
            console.log('[Recall Service] RecallClient initialized successfully.');
            recallClientInstance = client; isRecallInitialized = true; initPromise = null;
            return client;
        } catch (err: any) {
            const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
            console.error('[Recall Service] FATAL: Could not init RecallClient:', msg, err);
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
                let errMsg = 'Unknown transaction error'; let errDetails = {};
                if (err instanceof BaseError) { errMsg = err.shortMessage || err.message.split('\n')[0]; errDetails = { name: err.name, details: err.details, metaMessages: err.metaMessages }; }
                else if (err instanceof Error) { errMsg = err.message.split('\n')[0]; errDetails = { name: err.name, stack: err.stack?.substring(0, 300) }; }
                else { errMsg = String(err); }
                console.error(`[Recall Tx Queue] Transaction error: ${errMsg}`, errDetails);
                reject(err); // Reject the promise with the original error
            } finally {
                isProcessingTx = false; const nextTx = txQueue.shift();
                if (nextTx) { setImmediate(() => { nextTx().catch(queueError => { const qErrMsg = queueError?.shortMessage || queueError?.message || String(queueError); console.error("[Recall Tx Queue] Error processing subsequent queued tx:", qErrMsg.split('\n')[0]); }); }); }
            }
        };
        if (!isProcessingTx && txQueue.length === 0) { runTx(); } else { txQueue.push(runTx); }
    });
}


// --- LEAN Bucket Address Finder ---
/** Exported for potential use by other services needing the bucket address */
export async function findLogBucketAddressOrFail(recall: any): Promise<Address> { // Export findLogBucketAddressOrFail
    if (logBucketAddress) { return logBucketAddress; }
    console.log(`[Recall Service - findLogBucketAddressOrFail] Finding bucket by alias: ${RECALL_BUCKET_ALIAS}...`);
    const bucketManager = recall.bucketManager();
    try {
        const { result: listRes } = await bucketManager.list();
        const allBuckets = listRes?.buckets ?? [];
        for (const b of allBuckets) {
            try {
                const metaRes = await bucketManager.getMetadata(b);
                if (metaRes.result?.metadata?.alias === RECALL_BUCKET_ALIAS) {
                    const foundAddr = getAddress(b);
                    console.log('[Recall Service - findLogBucketAddressOrFail] Found existing log bucket by alias:', foundAddr);
                    logBucketAddress = foundAddr; // Cache it
                    return foundAddr;
                }
            } catch { /* ignore */ }
        }
    } catch (listError: any) { console.warn("[Recall Service - findLogBucketAddressOrFail] Error listing buckets:", listError.message); }
    throw new Error(`Log bucket with alias '${RECALL_BUCKET_ALIAS}' not found.`);
}


/** Check Recall Credits. Logs balance. Buys ONLY if zero. */
async function checkAndBuyRecallCreditsIfNeeded(recall: any): Promise<void> {
    const creditManager = recall.creditManager();
    const { result: creditBalance } = await creditManager.getCreditBalance();
    const creditFree = creditBalance?.creditFree ?? 0n;
    const creditFreeFormatted = formatEther(creditFree);
    console.log(`[Recall Service] Current Recall Credit Balance: ${creditFreeFormatted} RTC`);
    if (creditFree === 0n) {
        console.log('[RecallService] Recall credit_free is 0, attempting to buy 1 RTC credit...');
        try {
            const txHash = await processTxQueue(async () => {
                const { meta } = await creditManager.buy(parseEther("1")); // This tx requires native gas
                return meta?.tx?.transactionHash;
            });
            if (!txHash) throw new Error('Recall Credit buy transaction returned no hash.');
            console.log('Recall Credit purchase tx sent:', txHash);
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (buyError: any) {
             console.error(`[Recall Service] FAILED to buy Recall Credits: ${buyError.message}.`);
             throw new Error(`Failed to ensure Recall Credit balance: ${buyError.message}`);
        }
    }
}


// --- LEAN Core Function to Add Object with Overwrite Option ---
/**
 * Adds dataObject. Checks gas fees. Allows overwriting.
 * Assumes bucket exists, is approved, credits ok for ADD.
 * *** Exported ***
 */
export async function addObjectToBucket(
    dataObject: object,
    key: string,
    overwrite: boolean = false // Default overwrite to false
): Promise<{ success: boolean, bucket?: Address, key?: string, txHash?: string, error?: string, gasPriceTooHigh?: boolean }> {
    let recall: any; let bucketAddr: Address;
    const currentAccount = initializeAccount(); // Ensure account is initialized
    const publicClient = getPublicClient(); // Get public client instance

    try {
        recall = await getRecallClient();
        bucketAddr = await findLogBucketAddressOrFail(recall);

        const balance = await publicClient.getBalance({ address: currentAccount.address });
        console.log(`[Recall Service - addObjectToBucket OVW] Native Balance for ${currentAccount.address}: ${formatEther(balance)}`);

        await checkAndBuyRecallCreditsIfNeeded(recall); // Check Recall credits

    } catch (setupError: any) {
        const errMsg = setupError?.message?.split('\n')[0] || String(setupError);
        console.error(`[Recall Setup Error - OVW] addObjectToBucket for key ${key}:`, errMsg);
        return { success: false, error: `Setup failed: ${errMsg}`, key };
    }

    const contentStr = JSON.stringify(dataObject, null, 2);
    const fileBuffer = Buffer.from(contentStr, 'utf8');
    const bucketManager = recall.bucketManager();

    // --- Transaction Attempt with Retries & Gas Check ---
    for (let attempt = 1; attempt <= MAX_RPC_RETRIES; attempt++) {
        try {
            console.log(`[Recall Service OVW] Attempt ${attempt}/${MAX_RPC_RETRIES} to add object | Key: ${key} | Overwrite: ${overwrite}`);

            const txHash = await processTxQueue(async () => {
                 // --- Gas Price Check ---
                 console.log(`[Recall Tx Queue OVW] Checking gas fees before tx...`);
                 const feeEstimate = await publicClient!.estimateFeesPerGas();
                 const currentMaxPriorityFee = feeEstimate.maxPriorityFeePerGas ?? 0n;
                 console.log(`[Recall Tx Queue OVW] Estimated maxPriorityFeePerGas: ${formatGwei(currentMaxPriorityFee)} Gwei`);
                 if (currentMaxPriorityFee > MAX_ACCEPTABLE_PRIORITY_FEE_WEI) {
                     const errorMsg = `Gas price too high: Current priority fee (${formatGwei(currentMaxPriorityFee)} Gwei) exceeds threshold (${MAX_ACCEPTABLE_PRIORITY_FEE_GWEI} Gwei)`;
                     console.warn(`[Recall Tx Queue OVW] ${errorMsg}. Aborting transaction for key ${key}.`);
                     throw new Error(`GAS_PRICE_TOO_HIGH: ${errorMsg}`);
                 }
                 console.log(`[Recall Tx Queue OVW] Gas price acceptable. Proceeding with add tx (Overwrite: ${overwrite})...`);
                 const balanceBeforeTx = await publicClient!.getBalance({ address: currentAccount.address });
                 console.log(`[Recall Tx Queue OVW] Native Balance right before add tx: ${formatEther(balanceBeforeTx)}`);
                 // --- End Gas Price Check ---

                 // --- Correctly pass arguments based on SDK structure ---
                 // Assume options object is last argument containing gas and overwrite
                 const callOptions: { gas?: bigint, overwrite?: boolean } = {
                     gas: MANUAL_GAS_LIMIT, // Include manual gas limit
                 };
                 if (overwrite) {
                     callOptions.overwrite = true; // Set overwrite only if true
                 }

                 // Call with the structured options object
                 const { meta } = await bucketManager.add(bucketAddr, key, fileBuffer, callOptions);

                 return meta?.tx?.transactionHash;
            });

            if (!txHash) { console.warn(`[Recall Service OVW] addObjectToBucket for key ${key} (Attempt ${attempt}) ended with no txHash. Assuming success.`); return { success: true, bucket: bucketAddr, key }; }
            console.log(`[Recall Service OVW] Object stored/overwritten (Attempt ${attempt}). Key=${key.split('/').pop()}, Tx=${txHash.slice(0, 12)}..., fileBuffer=${fileBuffer}`);


            return { success: true, bucket: bucketAddr, key, txHash }; // Success!

        } catch (err: any) {
            let conciseError = `Attempt ${attempt} failed adding/overwriting object (key=${truncateText(key, 30)})`;
            let isRetryable = false; let isGasError = false; let isGasPriceError = false; let isKeyExistsError = false;

            if (err instanceof Error && err.message.startsWith('GAS_PRICE_TOO_HIGH:')) { conciseError = err.message; isGasPriceError = true; isRetryable = false; console.warn(`[Recall Service OVW] Transaction deferred due to high gas price (Attempt ${attempt}) for key ${key}`); }
            else if (err instanceof BaseError) {
                conciseError = `Attempt ${attempt}: ${err.shortMessage || err.message.split('\n')[0]}`;
                 const detailedMessage = err.message?.toLowerCase() || '';
                 if (detailedMessage.includes('key exists') && detailedMessage.includes('use overwrite')) {
                     console.error(`[Recall Service OVW] >> KEY EXISTS error (Attempt ${attempt}) for key ${key}. Overwrite flag was ${overwrite}.`);
                     isRetryable = false; isKeyExistsError = true;
                 }
                 else if (detailedMessage.includes('out of gas')) { console.error(`[Recall Service OVW] >> TRANSACTION RAN OUT OF GAS (Attempt ${attempt}) for key ${key}. Increase MANUAL_GAS_LIMIT.`); isRetryable = false; isGasError = true; }
                 else if (detailedMessage.includes('actor balance') && detailedMessage.includes('less than needed')) { console.error(`[Recall Service OVW] >> Detected insufficient NATIVE GAS balance error (Attempt ${attempt}) for key ${key}`); isRetryable = false; isGasError = true; }
                 else if (err.name === 'HttpRequestError' || conciseError.includes('RPC Request failed') || conciseError.includes('nonce') || conciseError.includes('timeout')) { isRetryable = true; }
                console.error(`[Recall Service OVW] addObjectToBucket Viem Error (Attempt ${attempt})`, { key, name: err.name });
            } else if (err instanceof Error) { conciseError = `Attempt ${attempt}: ${err.message.split('\n')[0]}`; console.error(`[Recall Service OVW] addObjectToBucket Generic Error (Attempt ${attempt})`, { key, name: err.name, message: err.message }); isRetryable = true;}
            else { conciseError = `Attempt ${attempt}: ${String(err)}`; console.error(`[Recall Service OVW] addObjectToBucket Unknown Error (Attempt ${attempt})`, { key, error: err }); isRetryable = true; }

            if (!isGasPriceError && !isKeyExistsError) { console.error(`[Recall Service OVW] addObjectToBucket error (Attempt ${attempt}): ${conciseError}`); }

            if (isRetryable && attempt < MAX_RPC_RETRIES) {
                const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
                console.log(`[Recall Service OVW] Retrying object add for key ${key} in ${delay / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                 if(isGasError) conciseError = `Insufficient native gas balance after ${attempt} attempts. Wallet: ${currentAccount.address}`;
                 else if(isGasPriceError) conciseError = `Gas price too high after ${attempt} attempts. Threshold: ${MAX_ACCEPTABLE_PRIORITY_FEE_GWEI} Gwei.`;
                 else if(isKeyExistsError) conciseError = `Key exists error despite overwrite=${overwrite} for key ${key}.`;
                 else conciseError = `Failed adding/overwriting object after ${attempt} attempts: ${conciseError}`;
                 console.error(`[Recall Service OVW] addObjectToBucket failed permanently for key ${key}. Error: ${conciseError}`);
                return { success: false, error: conciseError, key: key, gasPriceTooHigh: isGasPriceError };
            }
        }
    }
    // Fallback return
    return { success: false, error: `addObjectToBucket did not execute after ${MAX_RPC_RETRIES} attempts`, key: key };
}


// --- Logging Functions ---
// Wrapper to handle the gas price error specifically in logging functions
async function handleLogResult(
    logFunctionName: string,
    context: string,
    result: Awaited<ReturnType<typeof addObjectToBucket>>
): Promise<string | undefined> {
     if (result.success) {
         console.log(`[Recall Service] ${logFunctionName} successful | Context: ${context.substring(0,10)}`);
         return result.key || result.txHash; // Return key or hash
     } else {
         if (result.gasPriceTooHigh) {
             console.warn(`[Recall Service] ${logFunctionName} deferred due to high gas price | Context: ${context.substring(0,10)} | Key: ${result.key}`);
         } else {
             console.error(`[Recall Service] ${logFunctionName} failed | Context: ${context.substring(0,10)} | Error: ${result.error || 'Unknown failure'}`);
         }
         return undefined; // Indicate failure or deferral
     }
 }


export async function logQuestion( question: string, cid: string, requestContext: string ): Promise<string | undefined> {
    const key = `${QUESTIONS_PREFIX}${requestContext}.json`;
    const data: QuestionData = { question, cid, status: 'PendingAnswer', timestamp: new Date().toISOString(), requestContext };
    const result = await addObjectToBucket(data, key, false); // Don't overwrite questions
    return handleLogResult('logQuestion', requestContext, result);
}
export async function logAnswer( answer: string, answeringAgentId: string, requestContext: string ): Promise<string | undefined> {
     // Log to unique key per agent for consensus model
     const key = `${ANSWERS_PREFIX}${requestContext}/${getAddress(answeringAgentId)}.json`; // Use checksummed address
     const data: AnswerData = { answer, answeringAgentId, status: 'Submitted', timestamp: new Date().toISOString(), requestContext }; // Use 'Submitted' status for individual answer
     // Allow overwrite for idempotency by same agent
     const result = await addObjectToBucket(data, key, true);
     return handleLogResult('logAnswer', requestContext, result);
 }
export async function logVerdict( verdict: 'Correct' | 'Incorrect' | 'Uncertain', confidence: number, verifyingAgentId: string, requestContext: string ): Promise<string | undefined> {
    // Log to unique key per verifier
    const key = `${VERDICTS_PREFIX}${requestContext}/${getAddress(verifyingAgentId)}.json`; // Use checksummed address
    const data: VerdictData = { verdict, confidence, verifyingAgentId, timestamp: new Date().toISOString(), requestContext };
    // Allow overwrite if verifier runs again
    const result = await addObjectToBucket(data, key, true);
    return handleLogResult('logVerdict', requestContext, result);
}
export async function logErrorEvent( details: Record<string, any>, requestContext: string ): Promise<string | undefined> {
     const timestampSuffix = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
     const key = `${ERRORS_PREFIX}${requestContext}/${details.stage || 'Unknown'}_${timestampSuffix}.json`;
     const logEntry = { timestamp: new Date().toISOString(), type: 'ERROR_EVENT', details, requestContext }; // Type ideally RecallEventType
     console.log(`[Recall Service] Logging Error Event | Context: ${requestContext.substring(0,10)} | Stage: ${details.stage || 'Unknown'}`);
     // Don't overwrite error logs
     const result = await addObjectToBucket(logEntry, key, false);
      if (!result.success) { console.error(`[Recall Service] >> FAILED TO LOG ERROR EVENT << | Context: ${requestContext.substring(0,10)} | Stage: ${details.stage || 'Unknown'} | Reason: ${result.error}`); }
     return result.success ? (result.txHash || 'logged_no_tx_hash') : undefined;
}
// Exported function specifically for overwriting status logs
export async function logOverwrite( dataObject: object, key: string, logPrefix: string = "logOverwrite" ): Promise<string | undefined> {
    const context = key.split('/')[1] || 'unknownContext';
    console.log(`[Recall Service] Overwriting object | Prefix: ${logPrefix} | Key: ${key}`);
    const result = await addObjectToBucket(dataObject, key, true); // *** Set overwrite to true ***
    // Use handleLogResult for consistent output handling
    return handleLogResult(logPrefix, context, result);
}


// --- Function for Fetching Status ---
export async function getRequestStatus(requestContext: string): Promise<RequestStatus | null> {
    let recall: any; let bucketAddr: Address;
    try { recall = await getRecallClient(); bucketAddr = await findLogBucketAddressOrFail(recall); }
    catch (initError: any) { console.error('[Recall Service] getRequestStatus init error:', initError.message); return null; }
    const questionKey = `${QUESTIONS_PREFIX}${requestContext}.json`;
    const answerPrefix = `${ANSWERS_PREFIX}${requestContext}/`;
    const verdictPrefix = `${VERDICTS_PREFIX}${requestContext}/`;
    const evaluationKey = `${EVALUATION_RECALL_PREFIX}${requestContext}.json`;
    const payoutKey = `${PAYOUT_RECALL_PREFIX}${requestContext}.json`;

    async function fetchObject<T>(key: string): Promise<T | null> {
        try { const { result: objectBuf } = await recall.bucketManager().get(bucketAddr, key); if (!objectBuf) return null; return JSON.parse(Buffer.from(objectBuf).toString('utf8')) as T; }
        catch (error: any) { if (!error.message?.includes('Not Found')) { console.warn(`[Recall Service] Error fetching object for status key ${key}:`, error.message); } return null; }
    }
    async function checkPrefixExists(prefix: string): Promise<boolean> {
        try { const { result } = await recall.bucketManager().query(bucketAddr, { prefix, delimiter: '/', limit: 1 }); return (result?.objects?.length > 0 || result?.commonPrefixes?.length > 0); }
        catch (error: any) { console.warn(`[Recall Service] Error querying prefix ${prefix}:`, error.message); return false; }
    }

    try {
        const [questionData, hasAnswers, hasVerdicts, evaluationData, payoutData] = await Promise.all([
            fetchObject<QuestionData>(questionKey), checkPrefixExists(answerPrefix), checkPrefixExists(verdictPrefix),
            fetchObject<EvaluationResult>(evaluationKey), fetchObject<PayoutStatusData>(payoutKey)
        ]);

        if (!questionData) { return null; }

        let overallStatus: JobStatus = 'PendingAnswer';
        if (payoutData) { overallStatus = payoutData.success ? 'PayoutComplete' : 'Error'; }
        else if (evaluationData) {
            // Explicitly check against allowed EvaluationResult statuses before assigning to JobStatus
            const evalStatus = evaluationData.status;
            if (evalStatus === 'PendingPayout' || evalStatus === 'PayoutComplete' || evalStatus === 'Error' || evalStatus === 'NoValidAnswers') {
                 overallStatus = evalStatus;
            } else {
                 overallStatus = 'Error'; // Fallback if unexpected status
                 console.warn(`[Recall Service] Unexpected status in evaluation data for ${requestContext}: ${evalStatus}`);
            }
        }
        else if (hasAnswers) { overallStatus = 'PendingEvaluation'; }
        else { overallStatus = questionData.status || 'PendingAnswer'; }

        const statusResult: RequestStatus = {
            requestContext: requestContext, status: overallStatus,
            question: questionData.question, cid: questionData.cid, submittedAt: questionData.timestamp,
            hasAnswers: hasAnswers, evaluationStatus: evaluationData?.status,
            payoutStatus: payoutData?.success, payoutMessage: payoutData?.message,
            error: overallStatus === 'Error' ? (payoutData?.message || (evaluationData?.status === 'Error' ? 'Evaluation Error' : 'Processing error occurred')) : undefined,
        };
        return statusResult;
    } catch (error: any) {
        console.error(`[Recall Service] Unexpected error fetching status for ${requestContext}:`, error);
        return { requestContext: requestContext, status: 'Error', error: 'Internal error during status retrieval.', submittedAt: new Date().toISOString() };
    }
}


// --- Polling Function ---
// Export getPendingJobs for agent use
export async function getPendingJobs(prefix: string): Promise<{ key: string; data?: any }[]> {
     let recall: any; let bucketAddr: Address;
     try { recall = await getRecallClient(); bucketAddr = await findLogBucketAddressOrFail(recall); }
     catch (initError: any) { console.error(`[Recall Service] getPendingJobs init error for prefix ${prefix}:`, initError.message); return []; }
     try {
         const bucketManager = recall.bucketManager();
         const  result  = await bucketManager.query(bucketAddr, { prefix, delimiter: '' });

         console.log(result);
         const objectInfos = (result?.objects ?? []);
         if (!objectInfos.length) { return []; }
         const potentialJobs = objectInfos
             .map((o: any) => o.key)
             .filter((k: string | undefined): k is string => typeof k === 'string' && k.endsWith('.json'));
         return potentialJobs.map((key: string) => ({ key }));
     } catch (error: any) { console.error(`[Recall Service] Error polling jobs with prefix ${prefix}:`, error.message); return []; }
 }


// --- Helper to fetch object data ---
export async function getObjectData<T>(key: string): Promise<T | null> {
    let recall: any; let bucketAddr: Address;
    try {
        recall = await getRecallClient(); bucketAddr = await findLogBucketAddressOrFail(recall);
        const { result: objectBuf } = await recall.bucketManager().get(bucketAddr, key);
        if (!objectBuf) return null;
        return JSON.parse(Buffer.from(objectBuf).toString('utf8')) as T;
    } catch (error: any) { if (!error.message?.includes('Not Found')) { console.error(`[Recall Service] Error fetching object data for key ${key}:`, error.message); } return null; }
}


// --- Function to Delete Object ---
// Export deleteObject for agent use
export async function deleteObject(key: string): Promise<boolean> {
    let recall: any; let bucketAddr: Address;
    try {
        recall = await getRecallClient(); bucketAddr = await findLogBucketAddressOrFail(recall);
        await recall.bucketManager().delete(bucketAddr, key);
        return true;
    } catch (error: any) { if (!error.message?.includes('Not Found')) { console.error(`[Recall Service] Error deleting object ${key}:`, error.message); } return false; }
}

// --- Export logFinalVerificationTrace ---
export async function logFinalVerificationTrace( requestContext: string, verificationResult: VerificationResultInternal ): Promise<string | undefined> {
     console.warn("[Recall Service] logFinalVerificationTrace called - logging result of sync flow.");
     const logType: RecallEventType = verificationResult.finalVerdict.startsWith('Error:') ? 'VERIFICATION_ERROR' : 'VERIFICATION_COMPLETE';
     const finalLogObject: Partial<VerificationResultInternal> & { type: RecallEventType, timestamp: string, requestContext: string } = {
        timestamp: new Date().toISOString(), type: logType, requestContext,
        finalVerdict: verificationResult.finalVerdict, confidenceScore: verificationResult.confidenceScore,
        usedFragmentCids: verificationResult.usedFragmentCids, timelockRequestId: verificationResult.timelockRequestId,
        timelockCommitTxHash: verificationResult.timelockCommitTxHash, ciphertextHash: verificationResult.ciphertextHash,
     };
     const timeSfx = finalLogObject.timestamp.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
     const key = `${FINAL_RESULTS_PREFIX}${requestContext}/trace_${timeSfx}.json`;
     const result = await addObjectToBucket(finalLogObject, key, false); // Don't overwrite trace logs
     return handleLogResult('logFinalVerificationTrace', requestContext, result);
 }

// ==== ./services/recallService.ts (LEAN Version + Gas Check + Manual Gas Limit + Overwrite Fixed) ====