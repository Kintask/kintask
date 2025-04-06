// services/recallService.ts (LEAN Version)
import config from '../config';
import { QuestionData, AnswerData, VerdictData, RequestStatus, RecallLogEntryData, RecallEventType, VerificationResultInternal } from '../types';
import { testnet } from '@recallnet/chains';
import {
    createWalletClient, http, parseEther, formatEther, WalletClient, PublicClient, createPublicClient,
    BaseError, Address, ContractFunctionExecutionError, getAddress
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
let account: Account | null = null;
let isProcessingTx = false;
const txQueue: Array<() => Promise<any>> = [];
// --- NO approvedBuckets cache in LEAN version ---

// --- Constants & Prefixes ---
const MAX_RPC_RETRIES = 1; // Set retries to 1 (no retries) initially for faster failure diagnosis
const RETRY_DELAY_MS = 1500;
const QUESTIONS_PREFIX = "questions/";
const ANSWERS_PREFIX = "answers/";
const VERDICTS_PREFIX = "verdicts/";
const ERRORS_PREFIX = "errors/";
const FINAL_RESULTS_PREFIX = "final_results/";
const TIMELOCK_REVEALS_PREFIX = "timelock_reveals/";

// --- Helpers ---
function getRecallWalletClient(): WalletClient {
    const privateKey = config.recallPrivateKey;
    if (!privateKey) { throw new Error('No RECALL_PRIVATE_KEY found in config.'); }
    const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey as `0x${string}` : `0x${privateKey}` as `0x${string}`;
    if (!account) { account = privateKeyToAccount(formattedPrivateKey); console.log(`[Recall Service] Using wallet: ${account.address} on chain: ${testnet.id}`); }
    return createWalletClient({ account, chain: testnet, transport: http() });
}

function getPublicClient(): PublicClient {
    return createPublicClient({ chain: testnet, transport: http() });
}

async function getRecallClient(): Promise<any> {
    if (recallClientInstance && isRecallInitialized) { return recallClientInstance; }
    if (initPromise) { return initPromise; }
    initPromise = (async () => {
        console.log('[Recall Service] Initializing dynamic RecallClient...');
        try {
            const RecallClient = await loadRecallClientModule();
            const walletClient = getRecallWalletClient();
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
                reject(err);
            } finally {
                isProcessingTx = false; const nextTx = txQueue.shift();
                if (nextTx) { setImmediate(() => { nextTx().catch(queueError => { const qErrMsg = queueError?.shortMessage || queueError?.message || String(queueError); console.error("[Recall Tx Queue] Error processing subsequent queued tx:", qErrMsg.split('\n')[0]); }); }); }
            }
        };
        if (!isProcessingTx && txQueue.length === 0) { runTx(); } else { txQueue.push(runTx); }
    });
}


// --- LEAN Bucket Address Finder ---
/**
 * Finds the log bucket address. Assumes it exists. Does NOT create/approve/check credits.
 * Throws error if bucket cannot be confirmed.
 */
async function findLogBucketAddressOrFail(recall: any): Promise<Address> {
    if (logBucketAddress) {
        // console.log(`[Recall Service - findLogBucketAddressOrFail] Using cached address: ${logBucketAddress}`); // Less verbose
        return logBucketAddress;
    }
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
            } catch { /* ignore metadata errors during iteration */ }
        }
    } catch (listError: any) {
        console.warn("[Recall Service - findLogBucketAddressOrFail] Error listing buckets:", listError.message);
    }
    throw new Error(`Log bucket with alias '${RECALL_BUCKET_ALIAS}' not found. Ensure it exists or provide correct RECALL_LOG_BUCKET in .env.`);
}


/**
 * Check Recall Credits. Logs balance. Buys ONLY if zero.
 * Assumes the 'buy' transaction itself has gas funded separately.
 */
async function checkAndBuyRecallCreditsIfNeeded(recall: any): Promise<void> {
    // console.log('[Recall Service] Checking Recall Credit balance...'); // Less verbose
    const creditManager = recall.creditManager();
    const { result: creditBalance } = await creditManager.getCreditBalance();
    const creditFree = creditBalance?.creditFree ?? 0n;
    const creditFreeFormatted = formatEther(creditFree);
    console.log(`[Recall Service] Current Recall Credit Balance: ${creditFreeFormatted} RTC`);

    if (creditFree === 0n) {
        console.log('[RecallService] Recall credit_free is 0, attempting to buy 1 RTC credit...');
        try {
            const txHash = await processTxQueue(async () => {
                const { meta } = await creditManager.buy(parseEther("1"));
                return meta?.tx?.transactionHash;
            });
            if (!txHash) throw new Error('Recall Credit buy transaction returned no hash.');
            console.log('Recall Credit purchase tx sent:', txHash);
            await new Promise(resolve => setTimeout(resolve, 2000)); // Small delay
        } catch (buyError: any) {
             console.error(`[Recall Service] FAILED to buy Recall Credits: ${buyError.message}.`);
             throw new Error(`Failed to ensure Recall Credit balance: ${buyError.message}`);
        }
    }
    // else { console.log(`[Recall Service] Sufficient Recall Credits available.`); } // Less verbose
}


// --- LEAN Core Function to Add Object ---
/**
 * Adds dataObject to the standard log bucket. MINIMAL version.
 * Gets client, finds bucket, attempts 'add' transaction via queue.
 * ASSUMES bucket exists, is approved, and credits are sufficient.
 * *** Exported ***
 */
export async function addObjectToBucket(
    dataObject: object, key: string
): Promise<{ success: boolean, bucket?: Address, key?: string, txHash?: string, error?: string }> {
    let recall: any; let bucketAddr: Address; let publicClient: PublicClient | null = null;
    try {
        // 1. Get Client & Public Client
        recall = await getRecallClient();
        publicClient = getPublicClient();

        // 2. Find Bucket Address (throws if not found)
        bucketAddr = await findLogBucketAddressOrFail(recall);

        // 3. Log Native Balance (Crucial Debugging)
        const balance = await publicClient.getBalance({ address: account!.address });
        console.log(`[Recall Service - addObjectToBucket LEAN] Native Balance for ${account!.address}: ${formatEther(balance)}`);

        // 4. Check Recall Credits (optional buy, might fail on gas)
        await checkAndBuyRecallCreditsIfNeeded(recall);

        // --- NO ensureBucketApproval call here in LEAN version ---

    } catch (setupError: any) {
        const errMsg = setupError?.message?.split('\n')[0] || String(setupError);
        console.error(`[Recall Setup Error - LEAN] addObjectToBucket for key ${key}:`, errMsg);
        return { success: false, error: `Setup failed (finding bucket/client/credits): ${errMsg}`, key };
    }

    const contentStr = JSON.stringify(dataObject, null, 2);
    const fileBuffer = Buffer.from(contentStr, 'utf8');
    const bucketManager = recall.bucketManager();

    // --- Transaction Attempt with Retries ---
    for (let attempt = 1; attempt <= MAX_RPC_RETRIES; attempt++) {
        try {
            console.log(`[Recall Service LEAN] Attempt ${attempt}/${MAX_RPC_RETRIES} to add object | Key: ${key}`);
            const txHash = await processTxQueue(async () => {
                 const balanceBeforeTx = await publicClient!.getBalance({ address: account!.address });
                 console.log(`[Recall Tx Queue LEAN] Native Balance right before add tx: ${formatEther(balanceBeforeTx)}`);
                const { meta } = await bucketManager.add(bucketAddr, key, fileBuffer);
                return meta?.tx?.transactionHash;
            });

            if (!txHash) { console.warn(`[Recall Service LEAN] addObjectToBucket for key ${key} (Attempt ${attempt}) ended with no txHash. Assuming success.`); return { success: true, bucket: bucketAddr, key }; }
            console.log(`[Recall Service LEAN] Object stored (Attempt ${attempt}). Key=${key.split('/').pop()}, Tx=${txHash.slice(0, 12)}...`);
            return { success: true, bucket: bucketAddr, key, txHash }; // Success!

        } catch (err: any) {
            let conciseError = `Attempt ${attempt} failed adding object (key=${truncateText(key, 30)})`;
            let isRetryable = false; let isGasError = false;
            if (err instanceof BaseError) {
                conciseError = `Attempt ${attempt}: ${err.shortMessage || err.message.split('\n')[0]}`;
                 if (err.message?.includes('actor balance') && err.message?.includes('less than needed')) { console.error(`[Recall Service LEAN] >> Detected insufficient NATIVE GAS balance error (Attempt ${attempt}) for key ${key}`); isRetryable = false; isGasError = true; }
                 else if (err.name === 'HttpRequestError' || err.message.includes('RPC Request failed') || err.message.includes('nonce') || err.message.includes('timeout')) { isRetryable = true; }
                console.error(`[Recall Service LEAN] addObjectToBucket Viem Error (Attempt ${attempt})`, { key, name: err.name });
            } else if (err instanceof Error) { conciseError = `Attempt ${attempt}: ${err.message.split('\n')[0]}`; console.error(`[Recall Service LEAN] addObjectToBucket Generic Error (Attempt ${attempt})`, { key, name: err.name, message: err.message }); isRetryable = true;}
            else { conciseError = `Attempt ${attempt}: ${String(err)}`; console.error(`[Recall Service LEAN] addObjectToBucket Unknown Error (Attempt ${attempt})`, { key, error: err }); isRetryable = true; }

            console.error(`[Recall Service LEAN] addObjectToBucket error (Attempt ${attempt}): ${conciseError}`);
            if (isRetryable && attempt < MAX_RPC_RETRIES) {
                const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
                console.log(`[Recall Service LEAN] Retrying object add for key ${key} in ${delay / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                 if(isGasError) conciseError = `Insufficient native gas balance after ${attempt} attempts. Wallet: ${account?.address}`;
                 else conciseError = `Failed adding object after ${attempt} attempts: ${conciseError}`;
                 console.error(`[Recall Service LEAN] addObjectToBucket failed permanently for key ${key}. Error: ${conciseError}`);
                return { success: false, error: conciseError, key: key };
            }
        }
    }
    return { success: false, error: `addObjectToBucket did not execute after ${MAX_RPC_RETRIES} attempts`, key: key };
}


// --- Logging Functions (Unchanged, use LEAN addObjectToBucket) ---
export async function logQuestion( question: string, cid: string, requestContext: string ): Promise<string | undefined> {
    const key = `${QUESTIONS_PREFIX}${requestContext}.json`;
    const data: QuestionData = { question, cid, status: 'PendingAnswer', timestamp: new Date().toISOString(), requestContext };
    const result = await addObjectToBucket(data, key); // Uses LEAN version
    console.log(`[Recall Service] Logged question | Context: ${requestContext.substring(0,10)} | Success: ${result.success} | Error: ${result.error || 'None'}`);
    return result.success ? key : undefined;
}
export async function logAnswer( answer: string, answeringAgentId: string, requestContext: string ): Promise<string | undefined> {
     const key = `${ANSWERS_PREFIX}${requestContext}.json`;
     const data: AnswerData = { answer, answeringAgentId, status: 'PendingVerification', timestamp: new Date().toISOString(), requestContext };
     const result = await addObjectToBucket(data, key); // Uses LEAN version
     console.log(`[Recall Service] Logged answer | Context: ${requestContext.substring(0,10)} | Agent: ${answeringAgentId.substring(0,10)} | Success: ${result.success} | Error: ${result.error || 'None'}`);
     return result.success ? key : undefined;
 }
export async function logVerdict( verdict: 'Correct' | 'Incorrect' | 'Uncertain', confidence: number, verifyingAgentId: string, requestContext: string ): Promise<string | undefined> {
    const key = `${VERDICTS_PREFIX}${requestContext}/${verifyingAgentId}.json`;
    const data: VerdictData = { verdict, confidence, verifyingAgentId, timestamp: new Date().toISOString(), requestContext };
    const result = await addObjectToBucket(data, key); // Uses LEAN version
    console.log(`[Recall Service] Logged verdict | Context: ${requestContext.substring(0,10)} | Agent: ${verifyingAgentId.substring(0,10)} | Verdict: ${verdict} | Success: ${result.success} | Error: ${result.error || 'None'}`);
    return result.success ? key : undefined;
}
export async function logErrorEvent( details: Record<string, any>, requestContext: string ): Promise<string | undefined> {
     const timestampSuffix = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
     const key = `${ERRORS_PREFIX}${requestContext}/${details.stage || 'Unknown'}_${timestampSuffix}.json`;
     const logEntry = { timestamp: new Date().toISOString(), type: 'ERROR_EVENT', details, requestContext }; // Type ideally RecallEventType
     console.log(`[Recall Service] Logging Error Event | Context: ${requestContext.substring(0,10)} | Stage: ${details.stage || 'Unknown'}`);
     const result = await addObjectToBucket(logEntry, key); // Uses LEAN version
      console.log(`[Recall Service] Logged Error Event Result | Context: ${requestContext.substring(0,10)} | Success: ${result.success} | Error: ${result.error || 'None'}`);
     return result.success ? (result.txHash || 'logged_no_tx_hash') : undefined;
}

// --- Function for Fetching Status ---
export async function getRequestStatus(requestContext: string): Promise<RequestStatus | null> {
    let recall: any; let bucketAddr: Address;
    try { recall = await getRecallClient(); bucketAddr = await findLogBucketAddressOrFail(recall); }
    catch (initError: any) { console.error('[Recall Service] getRequestStatus init error:', initError.message); return null; }

    const questionKey = `${QUESTIONS_PREFIX}${requestContext}.json`;
    const answerKey = `${ANSWERS_PREFIX}${requestContext}.json`;
    const verdictPrefix = `${VERDICTS_PREFIX}${requestContext}/`;

    async function fetchObject<T>(key: string): Promise<T | null> {
        try {
            const { result: objectBuf } = await recall.bucketManager().get(bucketAddr, key);
            if (!objectBuf) return null;
            return JSON.parse(Buffer.from(objectBuf).toString('utf8')) as T;
        } catch (error: any) {
            if (!error.message?.includes('Not Found') && !error.message?.includes('not found')) { console.warn(`[Recall Service] Error fetching object for status key ${key}:`, error.message); }
            return null;
        }
    }
     async function checkVerdictsExist(): Promise<boolean> {
         try {
             const { result } = await recall.bucketManager().query(bucketAddr, { prefix: verdictPrefix, delimiter: '/' });
             return (result?.objects?.length > 0 || result?.commonPrefixes?.length > 0);
         } catch (error: any) { console.warn(`[Recall Service] Error querying verdicts for status prefix ${verdictPrefix}:`, error.message); return false; }
     }

    try {
        const [questionData, answerData, hasVerdicts] = await Promise.all([ fetchObject<QuestionData>(questionKey), fetchObject<AnswerData>(answerKey), checkVerdictsExist() ]);
        if (!questionData) { return null; }
        let overallStatus: RequestStatus['status'] = 'PendingAnswer';
        if (answerData) { overallStatus = 'PendingVerification'; if (hasVerdicts) { overallStatus = 'VerificationInProgress'; } }
        const statusResult: RequestStatus = { requestContext: requestContext, status: overallStatus, question: questionData.question, cid: questionData.cid, submittedAt: questionData.timestamp, answer: answerData?.answer, answeredAt: answerData?.timestamp, answeringAgentId: answerData?.answeringAgentId };
        return statusResult;
    } catch (error: any) {
        console.error(`[Recall Service] Unexpected error fetching status for ${requestContext}:`, error);
        return { requestContext: requestContext, status: 'Error', error: 'Internal error during status retrieval.', submittedAt: new Date().toISOString() };
    }
}


// --- Polling Function ---
export async function getPendingJobs(prefix: string): Promise<{ key: string; data?: any }[]> {
     let recall: any; let bucketAddr: Address;
     try { recall = await getRecallClient(); bucketAddr = await findLogBucketAddressOrFail(recall); }
     catch (initError: any) { console.error(`[Recall Service] getPendingJobs init error for prefix ${prefix}:`, initError.message); return []; }
     try {
         const bucketManager = recall.bucketManager();
         const { result } = await bucketManager.query(bucketAddr, { prefix, delimiter: '' });
         const objectInfos = (result?.objects ?? []);
         if (!objectInfos.length) { return []; }
         const potentialJobs = objectInfos
             .map((o: any) => o.key)
             .filter((k: string | undefined): k is string => typeof k === 'string' && k.endsWith('.json'));
         return potentialJobs.map((key: string) => ({ key }));
     } catch (error: any) {
         console.error(`[Recall Service] Error polling jobs with prefix ${prefix}:`, error.message);
         return [];
     }
 }


// --- Helper to fetch object data ---
export async function getObjectData<T>(key: string): Promise<T | null> {
    let recall: any; let bucketAddr: Address;
    try {
        recall = await getRecallClient(); bucketAddr = await findLogBucketAddressOrFail(recall);
        const { result: objectBuf } = await recall.bucketManager().get(bucketAddr, key);
        if (!objectBuf) return null;
        return JSON.parse(Buffer.from(objectBuf).toString('utf8')) as T;
    } catch (error: any) {
        if (!error.message?.includes('Not Found') && !error.message?.includes('not found')) { console.error(`[Recall Service] Error fetching object data for key ${key}:`, error.message); }
        return null;
    }
}


// --- Function to Delete Object ---
export async function deleteObject(key: string): Promise<boolean> {
    let recall: any; let bucketAddr: Address;
    try {
        recall = await getRecallClient(); bucketAddr = await findLogBucketAddressOrFail(recall);
        await recall.bucketManager().delete(bucketAddr, key);
        return true;
    } catch (error: any) {
        if (!error.message?.includes('Not Found') && !error.message?.includes('not found')) { console.error(`[Recall Service] Error deleting object ${key}:`, error.message); }
        return false;
    }
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
    const result = await addObjectToBucket(finalLogObject, key); // Uses LEAN version
    return result.success ? result.txHash : undefined;
}

// ==== ./services/recallService.ts (LEAN Version) ====