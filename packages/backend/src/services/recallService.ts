// services/recallService.ts (LEAN Version + Gas Check + Manual Gas Limit)
import config from '../config';
import { QuestionData, AnswerData, VerdictData, RequestStatus, RecallLogEntryData, RecallEventType, VerificationResultInternal } from '../types';
import { testnet } from '@recallnet/chains';
import {
    createWalletClient, http, parseEther, formatEther, WalletClient, PublicClient, createPublicClient,
    BaseError, Address, ContractFunctionExecutionError, getAddress, parseGwei, formatGwei // Import formatGwei
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
const MAX_RPC_RETRIES = 3; // Restore a few retries now we're trying manual limit
const RETRY_DELAY_MS = 1500;
const QUESTIONS_PREFIX = "questions/"; const ANSWERS_PREFIX = "answers/"; const VERDICTS_PREFIX = "verdicts/"; const ERRORS_PREFIX = "errors/"; const FINAL_RESULTS_PREFIX = "final_results/"; const TIMELOCK_REVEALS_PREFIX = "timelock_reveals/";

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
 * Initializes the Viem Account from the private key.
 */
function initializeAccount(): Account {
    if (account) return account; // Return existing account

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
    return createPublicClient({
        chain: testnet,
        transport: http(),
    });
}

async function getRecallClient(): Promise<any> {
    if (recallClientInstance && isRecallInitialized) { return recallClientInstance; }
    if (initPromise) { return initPromise; }
    initPromise = (async () => {
        console.log('[Recall Service] Initializing dynamic RecallClient...');
        try {
            initializeAccount(); // Ensure account object exists before client init
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
/**
 * Finds the log bucket address. Assumes it exists. Does NOT create/approve/check credits.
 * Throws error if bucket cannot be confirmed.
 */
async function findLogBucketAddressOrFail(recall: any): Promise<Address> {
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
    throw new Error(`Log bucket with alias '${RECALL_BUCKET_ALIAS}' not found. Ensure it exists or provide correct RECALL_LOG_BUCKET in .env.`);
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


// --- LEAN Core Function to Add Object with Manual Gas Limit ---
export async function addObjectToBucket(
    dataObject: object, key: string
): Promise<{ success: boolean, bucket?: Address, key?: string, txHash?: string, error?: string, gasPriceTooHigh?: boolean }> {
    let recall: any; let bucketAddr: Address;
    const currentAccount = initializeAccount(); // Ensure account is initialized
    const publicClient = getPublicClient(); // Get public client instance

    try {
        recall = await getRecallClient();
        bucketAddr = await findLogBucketAddressOrFail(recall);

        const balance = await publicClient.getBalance({ address: currentAccount.address });
        console.log(`[Recall Service - addObjectToBucket MANUAL_GAS] Native Balance for ${currentAccount.address}: ${formatEther(balance)}`);

        await checkAndBuyRecallCreditsIfNeeded(recall);

    } catch (setupError: any) {
        const errMsg = setupError?.message?.split('\n')[0] || String(setupError);
        console.error(`[Recall Setup Error - MANUAL_GAS] addObjectToBucket for key ${key}:`, errMsg);
        return { success: false, error: `Setup failed: ${errMsg}`, key };
    }

    const contentStr = JSON.stringify(dataObject, null, 2);
    const fileBuffer = Buffer.from(contentStr, 'utf8');
    const bucketManager = recall.bucketManager();

    // --- Transaction Attempt with Retries & Manual Gas ---
    for (let attempt = 1; attempt <= MAX_RPC_RETRIES; attempt++) {
        try {
            console.log(`[Recall Service MANUAL_GAS] Attempt ${attempt}/${MAX_RPC_RETRIES} to add object | Key: ${key}`);

            // Perform Gas Price Check INSIDE Queue Callback
            const txHash = await processTxQueue(async () => {
                 console.log(`[Recall Tx Queue MANUAL_GAS] Checking gas fees before tx...`);
                 const feeEstimate = await publicClient!.estimateFeesPerGas();
                 const currentMaxPriorityFee = feeEstimate.maxPriorityFeePerGas ?? 0n;
                 console.log(`[Recall Tx Queue MANUAL_GAS] Estimated maxPriorityFeePerGas: ${formatGwei(currentMaxPriorityFee)} Gwei`);

                 if (currentMaxPriorityFee > MAX_ACCEPTABLE_PRIORITY_FEE_WEI) {
                     const errorMsg = `Gas price too high: Current priority fee (${formatGwei(currentMaxPriorityFee)} Gwei) exceeds threshold (${MAX_ACCEPTABLE_PRIORITY_FEE_GWEI} Gwei)`;
                     console.warn(`[Recall Tx Queue MANUAL_GAS] ${errorMsg}. Aborting transaction for key ${key}.`);
                     throw new Error(`GAS_PRICE_TOO_HIGH: ${errorMsg}`);
                 }

                 console.log(`[Recall Tx Queue MANUAL_GAS] Gas price acceptable. Proceeding with add tx with MANUAL limit: ${MANUAL_GAS_LIMIT}...`);
                 const balanceBeforeTx = await publicClient!.getBalance({ address: currentAccount.address });
                 console.log(`[Recall Tx Queue MANUAL_GAS] Native Balance right before add tx: ${formatEther(balanceBeforeTx)}`);

                 // --- Actual Transaction with Manual Gas Limit ---
                 // *** This is the critical part - how does Recall SDK accept overrides? ***
                 // Option A: Last argument is options object (Common in ethers style)
                  const txOptions = {
                      gas: MANUAL_GAS_LIMIT
                  };
                  // const { meta } = await bucketManager.add(bucketAddr, key, fileBuffer, txOptions); // TRY THIS FIRST

                 // Option B: Overrides within another argument (Less common but possible)
                 // Check if bucketManager.add has a structure like:
                 // add(bucket, key, data, { overrides?: { gas?: bigint } })
                 // In which case it would be:
                 // const { meta } = await bucketManager.add(bucketAddr, key, fileBuffer, { overrides: txOptions }); // TRY THIS SECOND if Option A fails

                 // *** You MUST confirm the correct way from Recall SDK documentation ***
                 // Using Option A as the placeholder:
                 const { meta } = await bucketManager.add(bucketAddr, key, fileBuffer, txOptions);
                 // --- End Transaction ---

                 return meta?.tx?.transactionHash;
            });

            if (!txHash) { console.warn(`[Recall Service MANUAL_GAS] addObjectToBucket for key ${key} (Attempt ${attempt}) ended with no txHash. Assuming success.`); return { success: true, bucket: bucketAddr, key }; }
            console.log(`[Recall Service MANUAL_GAS] Object stored (Attempt ${attempt}). Key=${key.split('/').pop()}, Tx=${txHash.slice(0, 12)}...`);
            return { success: true, bucket: bucketAddr, key, txHash };

        } catch (err: any) {
            // --- Error Handling (Keep detailed logging) ---
            let conciseError = `Attempt ${attempt} failed adding object (key=${truncateText(key, 30)})`;
            let isRetryable = false; let isGasError = false; let isGasPriceError = false;

            if (err instanceof Error && err.message.startsWith('GAS_PRICE_TOO_HIGH:')) {
                conciseError = err.message; isGasPriceError = true; isRetryable = false;
                console.warn(`[Recall Service MANUAL_GAS] Transaction deferred due to high gas price (Attempt ${attempt}) for key ${key}`);
            }
            else if (err instanceof BaseError) {
                conciseError = `Attempt ${attempt}: ${err.shortMessage || err.message.split('\n')[0]}`;
                 if (err.message?.toLowerCase().includes('out of gas')) { console.error(`[Recall Service MANUAL_GAS] >> TRANSACTION RAN OUT OF GAS (Attempt ${attempt}) for key ${key}. Increase MANUAL_GAS_LIMIT.`); isRetryable = false; isGasError = true; }
                 else if (err.message?.includes('actor balance') && err.message?.includes('less than needed')) { console.error(`[Recall Service MANUAL_GAS] >> Detected insufficient NATIVE GAS balance error (Attempt ${attempt}) for key ${key}`); isRetryable = false; isGasError = true; }
                 else if (err.name === 'HttpRequestError' || err.message.includes('RPC Request failed') || err.message.includes('nonce') || err.message.includes('timeout')) { isRetryable = true; }
                console.error(`[Recall Service MANUAL_GAS] addObjectToBucket Viem Error (Attempt ${attempt})`, { key, name: err.name });
            } else if (err instanceof Error) { conciseError = `Attempt ${attempt}: ${err.message.split('\n')[0]}`; console.error(`[Recall Service MANUAL_GAS] addObjectToBucket Generic Error (Attempt ${attempt})`, { key, name: err.name, message: err.message }); isRetryable = true;}
            else { conciseError = `Attempt ${attempt}: ${String(err)}`; console.error(`[Recall Service MANUAL_GAS] addObjectToBucket Unknown Error (Attempt ${attempt})`, { key, error: err }); isRetryable = true; }

            if (!isGasPriceError) { console.error(`[Recall Service MANUAL_GAS] addObjectToBucket error (Attempt ${attempt}): ${conciseError}`); }

            if (isRetryable && attempt < MAX_RPC_RETRIES) {
                const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
                console.log(`[Recall Service MANUAL_GAS] Retrying object add for key ${key} in ${delay / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                 if(isGasError) conciseError = `Insufficient native gas balance after ${attempt} attempts. Wallet: ${currentAccount.address}`;
                 else if(isGasPriceError) conciseError = `Gas price too high after ${attempt} attempts. Threshold: ${MAX_ACCEPTABLE_PRIORITY_FEE_GWEI} Gwei.`;
                 else conciseError = `Failed adding object after ${attempt} attempts: ${conciseError}`;
                 console.error(`[Recall Service MANUAL_GAS] addObjectToBucket failed permanently for key ${key}. Error: ${conciseError}`);
                return { success: false, error: conciseError, key: key, gasPriceTooHigh: isGasPriceError };
            }
        }
    }
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
         return result.key; // Or result.txHash if preferred
     } else {
         if (result.gasPriceTooHigh) {
             console.warn(`[Recall Service] ${logFunctionName} deferred due to high gas price | Context: ${context.substring(0,10)} | Key: ${result.key}`);
         } else {
             console.error(`[Recall Service] ${logFunctionName} failed | Context: ${context.substring(0,10)} | Error: ${result.error || 'Unknown failure'}`);
         }
         return undefined;
     }
 }


export async function logQuestion( question: string, cid: string, requestContext: string ): Promise<string | undefined> {
    const key = `${QUESTIONS_PREFIX}${requestContext}.json`;
    const data: QuestionData = { question, cid, status: 'PendingAnswer', timestamp: new Date().toISOString(), requestContext };
    const result = await addObjectToBucket(data, key);
    return handleLogResult('logQuestion', requestContext, result);
}
export async function logAnswer( answer: string, answeringAgentId: string, requestContext: string ): Promise<string | undefined> {
     const key = `${ANSWERS_PREFIX}${requestContext}.json`; // Using single answer key for now
     const data: AnswerData = { answer, answeringAgentId, status: 'PendingVerification', timestamp: new Date().toISOString(), requestContext };
     const result = await addObjectToBucket(data, key);
     return handleLogResult('logAnswer', requestContext, result);
 }
export async function logVerdict( verdict: 'Correct' | 'Incorrect' | 'Uncertain', confidence: number, verifyingAgentId: string, requestContext: string ): Promise<string | undefined> {
    const key = `${VERDICTS_PREFIX}${requestContext}/${verifyingAgentId}.json`;
    const data: VerdictData = { verdict, confidence, verifyingAgentId, timestamp: new Date().toISOString(), requestContext };
    const result = await addObjectToBucket(data, key);
    return handleLogResult('logVerdict', requestContext, result);
}
export async function logErrorEvent( details: Record<string, any>, requestContext: string ): Promise<string | undefined> {
     const timestampSuffix = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
     const key = `${ERRORS_PREFIX}${requestContext}/${details.stage || 'Unknown'}_${timestampSuffix}.json`;
     const logEntry = { timestamp: new Date().toISOString(), type: 'ERROR_EVENT', details, requestContext };
     console.log(`[Recall Service] Logging Error Event | Context: ${requestContext.substring(0,10)} | Stage: ${details.stage || 'Unknown'}`);
     const result = await addObjectToBucket(logEntry, key);
      if (!result.success) { console.error(`[Recall Service] >> FAILED TO LOG ERROR EVENT << | Context: ${requestContext.substring(0,10)} | Stage: ${details.stage || 'Unknown'} | Reason: ${result.error}`); }
     return result.success ? (result.txHash || 'logged_no_tx_hash') : undefined;
}

// --- Function for Fetching Status ---
export async function getRequestStatus(requestContext: string): Promise<RequestStatus | null> {
    let recall: any; let bucketAddr: Address;
    try { recall = await getRecallClient(); bucketAddr = await findLogBucketAddressOrFail(recall); }
    catch (initError: any) { console.error('[Recall Service] getRequestStatus init error:', initError.message); return null; }
    const questionKey = `${QUESTIONS_PREFIX}${requestContext}.json`;
    const answerKey = `${ANSWERS_PREFIX}${requestContext}.json`; // Adjust if using agentId in key
    const verdictPrefix = `${VERDICTS_PREFIX}${requestContext}/`;
    async function fetchObject<T>(key: string): Promise<T | null> {
        try { const { result: objectBuf } = await recall.bucketManager().get(bucketAddr, key); if (!objectBuf) return null; return JSON.parse(Buffer.from(objectBuf).toString('utf8')) as T; }
        catch (error: any) { if (!error.message?.includes('Not Found')) { console.warn(`[Recall Service] Error fetching object for status key ${key}:`, error.message); } return null; }
    }
    async function checkVerdictsExist(): Promise<boolean> {
        try { const { result } = await recall.bucketManager().query(bucketAddr, { prefix: verdictPrefix, delimiter: '/' }); return (result?.objects?.length > 0 || result?.commonPrefixes?.length > 0); }
        catch (error: any) { console.warn(`[Recall Service] Error querying verdicts for status prefix ${verdictPrefix}:`, error.message); return false; }
    }
    try {
        const [questionData, answerData, hasVerdicts] = await Promise.all([ fetchObject<QuestionData>(questionKey), fetchObject<AnswerData>(answerKey), checkVerdictsExist() ]);
        if (!questionData) { return null; }
        let overallStatus: RequestStatus['status'] = 'PendingAnswer';
        if (answerData) { overallStatus = 'PendingVerification'; if (hasVerdicts) { overallStatus = 'VerificationInProgress'; } }
        const statusResult: RequestStatus = { requestContext: requestContext, status: overallStatus, question: questionData.question, cid: questionData.cid, submittedAt: questionData.timestamp, answer: answerData?.answer, answeredAt: answerData?.timestamp, answeringAgentId: answerData?.answeringAgentId };
        return statusResult;
    } catch (error: any) { console.error(`[Recall Service] Unexpected error fetching status for ${requestContext}:`, error); return { requestContext: requestContext, status: 'Error', error: 'Internal error during status retrieval.', submittedAt: new Date().toISOString() }; }
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
     const result = await addObjectToBucket(finalLogObject, key); // Uses GAS_CHECK version
     return handleLogResult('logFinalVerificationTrace', requestContext, result);
 }

// Helper to format Gwei (requires formatEther)
// function formatGwei(weiValue: bigint): string {
//     const etherValue = parseFloat(formatEther(weiValue));
//     return (etherValue * 1e9).toFixed(3);
// }

// ==== ./services/recallService.ts (LEAN Version + Gas Check + Manual Gas Limit) ====