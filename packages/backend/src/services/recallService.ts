// services/recallService.ts (Restructured Keys, No Overwrite, logAnswerEvidence Added, Original Gas Settings)
import config from '../config';
import { QuestionData, AnswerData, EvaluationResult, PayoutStatusData, RequestStatus, JobStatus, RecallEventType } from '../types';
import { testnet } from '@recallnet/chains';
import {
    createWalletClient, http, parseEther, formatEther, WalletClient, PublicClient, createPublicClient,
    BaseError, Address, ContractFunctionExecutionError, getAddress, parseGwei, formatGwei
} from 'viem';
import { privateKeyToAccount, Account } from 'viem/accounts';
import { truncateText } from '../utils';

import { ethers } from 'ethers'; // <<< NOTE: You imported ethers here
import { createPaymentStatement } from './fvmContractService';   // <-- Adjust path as needed!




// Interface for the evidence metadata object
// Define it here as it's used internally by logAnswerEvidence
interface AnswerEvidenceMetadata {
    requestContext: string;
    answeringAgentId: Address;
    answerKey?: string; // Key where the raw answer is stored
    evidenceDataCid: string; // Root CID of the evidence CAR
    evidenceCarSize: number;
    evidencePieceCid: string; // (Simulated) Piece CID
    evidencePieceSize: number; // (Simulated) Piece Size
    evidenceCarUrl?: string; // Simulated URL (optional)
    submittedDealId: bigint | number | string; // Accept multiple types before converting to string
    submissionTxHash?: string; // Hash of the successful submitVerifiedEvaluation call
    timestamp?: string; // Optional timestamp
}


// --- Dynamic Import ---
let RecallClientModule: any = null;
async function loadRecallClientModule() {
    if (!RecallClientModule) {
        console.log("[Recall Service] Dynamically importing @recallnet/sdk/client...");
        RecallClientModule = await import('@recallnet/sdk/client');
        console.log("[Recall Service] SDK Client module loaded.");
    }
    // Ensure the expected export exists before returning
    if (!RecallClientModule?.RecallClient) {
        throw new Error("RecallClient class not found in imported module '@recallnet/sdk/client'");
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

// --- Constants & Prefixes ---
const MAX_RPC_RETRIES = 100;
const RETRY_DELAY_MS = 15000;
const CONTEXT_DATA_PREFIX = "reqs/"; //


const MAX_PROXY_ERROR_RETRIES = 100; // How many times to retry specifically on Proxy/Fetch errors
const PROXY_RETRY_DELAY_MS = 2500; // Delay between proxy error retries
const BUCKET_ERROR = 100; // How many times to retry specifically on Proxy/Fetch errors


// --- Key Generation Helpers ---
// These helpers were part of your original code in this file
const getQuestionKey = (ctx: string) => `${CONTEXT_DATA_PREFIX}${ctx}/question.json`;
const getAnswerKey = (ctx: string, agentId: Address) => `${CONTEXT_DATA_PREFIX}${ctx}/answers/${getAddress(agentId)}.json`; // Added getAddress for consistency
const getEvaluationKey = (ctx: string) => `${CONTEXT_DATA_PREFIX}${ctx}/evaluation.json`;
const getPayoutKey = (ctx: string) => `${CONTEXT_DATA_PREFIX}${ctx}/payout.json`;
const getAnswersPrefix = (ctx: string) => `${CONTEXT_DATA_PREFIX}${ctx}/answers/`;
const getEvidenceLogKey = (ctx: string, agentId: Address) => `${CONTEXT_DATA_PREFIX}${ctx}/evidence/${getAddress(agentId)}.json`; // Key for evidence log

// --- Gas Settings (Restored from your version) ---
const MAX_ACCEPTABLE_PRIORITY_FEE_GWEI = '0.0005'; // Your original value
const MAX_ACCEPTABLE_PRIORITY_FEE_WEI = parseGwei(MAX_ACCEPTABLE_PRIORITY_FEE_GWEI);
const MANUAL_GAS_LIMIT = 20_000n;
console.log(`[Recall Service] Max acceptable priority fee set to: ${MAX_ACCEPTABLE_PRIORITY_FEE_GWEI} Gwei`);
console.log(`[Recall Service] Manual Gas Limit (for Recall Add?) set to: ${MANUAL_GAS_LIMIT.toString()}`); // Clarified log


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

// Using YOUR original getRecallWalletClient
function getRecallWalletClient(): WalletClient {
    const acc = initializeAccount();
    return createWalletClient({ account: acc, chain: testnet, transport: http() });
}

// Using YOUR original getPublicClient
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
//    await checkAndBuyRecallCreditsIfNeeded(recall);
    } catch (setupError: any) { const errMsg = setupError?.message?.split('\n')[0] || String(setupError); console.error(`[Recall Setup Error - addObj] Key ${key}:`, errMsg); return { success: false, error: `Setup failed: ${errMsg}`, key }; }

    const contentStr = JSON.stringify(dataObject, null, 2);
    const fileBuffer = Buffer.from(contentStr, 'utf8');
    const bucketManager = recall.bucketManager();

    // --- Key Existence Pre-Check ---
    try {
     //   console.log(`[Recall Service - addObj] Checking existence for key: ${key}`);
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
                if (currentMaxPriorityFee > MAX_ACCEPTABLE_PRIORITY_FEE_WEI) {
                    const errorMsg = `Gas price too high (${formatGwei(currentMaxPriorityFee)} > ${MAX_ACCEPTABLE_PRIORITY_FEE_GWEI} Gwei)`;
                    console.warn(`[Recall Tx Queue] ${errorMsg}. Waiting and retrying for key ${key}.`);
                    throw new Error(`GAS_PRICE_TOO_HIGH: ${errorMsg}`);
                }
                console.log(`[Recall Tx Queue] Gas price ok. Proceeding with add tx...`);
                const balanceBefore = await publicClient!.getBalance({ address: currentAccount.address });
                console.log(`[Recall Tx Queue] Native Balance pre-tx: ${formatEther(balanceBefore)}`);
                // Using YOUR original MANUAL_GAS_LIMIT
                const callOptions: { gas?: bigint } = { gas: MANUAL_GAS_LIMIT };
                const { meta } = await bucketManager.add(bucketAddr, key, fileBuffer, callOptions);
                return meta?.tx?.transactionHash;
            });

            if (!txHash) { console.warn(`[Recall Service] AddObject for key ${key} (Attempt ${attempt}) no txHash.`); return { success: true, bucket: bucketAddr, key }; }
            console.log(`[Recall Service] Object added (Attempt ${attempt}). Key=${key.split('/').pop()}, Tx=${txHash.slice(0, 12)}...`);
            return { success: true, bucket: bucketAddr, key, txHash }; // Success!

        } catch (err: any) {
            let conciseError = `Attempt ${attempt} failed adding object (key=${truncateText(key, 30)})`;
            let isRetryable = true; let isGasError = false; let isGasPriceError = false;
            if (err instanceof Error && err.message.startsWith('GAS_PRICE_TOO_HIGH:')) { conciseError = err.message; isGasPriceError = true; isRetryable = true; console.warn(`[Recall Service] Tx deferred (high gas price) key ${key}. Will retry.`); }
            else if (err instanceof BaseError) { conciseError = `Attempt ${attempt}: ${err.shortMessage || err.message.split('\n')[0]}`; const detailedMessage = err.message?.toLowerCase() || ''; if (detailedMessage.includes('key exists')) { console.error(`[Recall Service] >> UNEXPECTED KEY EXISTS (Attempt ${attempt}) key ${key}. Pre-check failed?`); isRetryable = false; } else if (detailedMessage.includes('out of gas')) { console.error(`[Recall Service] >> OUT OF GAS (Attempt ${attempt}) key ${key}. Limit: ${MANUAL_GAS_LIMIT}.`); isRetryable = false; isGasError = true; } else if (detailedMessage.includes('actor balance') && detailedMessage.includes('less than needed')) { console.error(`[Recall Service] >> INSUFFICIENT NATIVE GAS BALANCE (Attempt ${attempt}) key ${key}`); isRetryable = false; isGasError = true; } else if (err.name === 'HttpRequestError' || conciseError.includes('RPC Request failed') || conciseError.includes('nonce') || conciseError.includes('timeout')) { isRetryable = true; } else { isRetryable = false; } console.error(`[Recall Service] AddObject Viem Error (Attempt ${attempt})`, { key, name: err.name }); }
            else if (err instanceof Error) { conciseError = `Attempt ${attempt}: ${err.message.split('\n')[0]}`; console.error(`[Recall Service] AddObject Generic Error (Attempt ${attempt})`, { key, name: err.name }); isRetryable = true; }
            else { conciseError = `Attempt ${attempt}: ${String(err)}`; console.error(`[Recall Service] AddObject Unknown Error (Attempt ${attempt})`, { key, error: err }); isRetryable = true; }
            if (!isGasPriceError) { console.error(`[Recall Service] addObjectToBucket error (Attempt ${attempt}): ${conciseError}`); }
            if (isRetryable && attempt < MAX_RPC_RETRIES) { const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1); console.log(`[Recall Service] Retrying add key ${key} in ${delay / 1000}s...`); await new Promise(resolve => setTimeout(resolve, delay)); }
            else { if (isGasError) conciseError = `Insuff. native gas or low limit after ${attempt} att. Wallet: ${currentAccount.address}. Limit: ${MANUAL_GAS_LIMIT}`; else if (isGasPriceError) conciseError = `Gas price too high after ${attempt} att. Threshold: ${MAX_ACCEPTABLE_PRIORITY_FEE_GWEI} Gwei.`; else conciseError = `Failed adding object after ${attempt} att: ${conciseError}`; console.error(`[Recall Service] addObjectToBucket failed permanently key ${key}. Error: ${conciseError}`); return { success: false, error: conciseError, key: key, gasPriceTooHigh: isGasPriceError }; }
        }
    }
    // This return was missing in your original, added for completeness
    return { success: false, error: `addObjectToBucket max retries (${MAX_RPC_RETRIES}) exceeded without success or failure`, key: key };
}


// --- Logging Functions (Using New Structure, No Overwrite) ---

// Wrapper to handle results consistently with clearer log messages
async function handleLogResult(
    logType: 'Question' | 'Answer' | 'Evaluation' | 'Payout' | 'AnswerEvidence',
    context: string,
    agentId: string | null, // Using string from original
    result: Awaited<ReturnType<typeof addObjectToBucket>>
): Promise<string | undefined> { // Added return type from original
    const agentStr = agentId ? ` | Agt: ${agentId.substring(0, 10)}...` : '';
    const shortCtx = context.substring(0, 10);

    if (result.success) {
        console.log(`[Recall Service] Logged ${logType} OK | Ctx: ${shortCtx}${agentStr} | Key: ${result.key}`);
        // Return key or txHash based on original logic
        return result.key || result.txHash;
    } else if (result.keyExists) {
        console.warn(`[Recall Service] Log ${logType} SKIPPED (Key Exists) | Ctx: ${shortCtx}${agentStr} | Key: ${result.key}`);
        // Decide return value - original didn't explicitly handle this case's return
        return result.key; // Return key to indicate existence
    } else if (result.gasPriceTooHigh) {
        console.warn(`[Recall Service] Log ${logType} DEFERRED (Gas Price) | Ctx: ${shortCtx}${agentStr} | Key: ${result.key}`);
    } else {
        console.error(`[Recall Service] Log ${logType} FAILED | Ctx: ${shortCtx}${agentStr} | Error: ${result.error || 'Unknown failure'} | Key: ${result.key}`);
    }
    return undefined; // Return undefined on failure/deferral
}


/** Log the initial question. */
export async function logQuestion(
    question: string, // <<< Receives the RAW question string
    cid: string,
    requestContext: string,
    user: string
): Promise<string | undefined> {
    console.log(`[Recall Service] Logging question for context: ${requestContext}`);
    const arbiterAddress = config.zkpValidatorAddress;
    if (!arbiterAddress) {
        console.error(`[Recall Service] Cannot log question: ZKP_VALIDATOR_ADDRESS not configured.`);
        return undefined;
    }

    const paymentToken = ethers.constants.AddressZero; // Native token (Ethers v5)
    const paymentAmount = ethers.utils.parseUnits('0.001', 18); // Ethers v5

    // --- ABI Encode the demand HERE ---
    let encodedDemand;
    try {
        encodedDemand = ethers.utils.defaultAbiCoder.encode(["string"], [question]); // Ethers v5
        console.log(`[Recall Service] ABI Encoded question for demand: ${encodedDemand}`);
    } catch (encodeError: any) {
        console.error(`[Recall Service] Failed to ABI encode question "${question}": ${encodeError.message}`);
        return undefined; // Cannot proceed if encoding fails
    }
    // --- End Encoding ---


    let paymentUID: string;
    try {
        console.log(`[Recall Service] Calling createPaymentStatement with encoded demand...`);
        // <<< Pass the ENCODED demand string to createPaymentStatement >>>
        paymentUID = await createPaymentStatement(paymentToken, paymentAmount, arbiterAddress, encodedDemand);
        console.log(`[Recall Service] Payment Statement created successfully by fvmContractService. PaymentUID: ${paymentUID}`);
    } catch (paymentError: any) {
        console.error(`[Recall Service] FAILED during createPaymentStatement call for context ${requestContext}: ${paymentError.message}`);
        return undefined;
    }

    // Log Question Data to Recall (including the paymentUID)
    const key = getQuestionKey(requestContext); // Ensure getQuestionKey is defined
    const data: QuestionData = { question, cid, status: 'PendingAnswer', timestamp: new Date().toISOString(), requestContext, paymentUID, user };
    const result = await addObjectToBucket(data, key); // Ensure addObjectToBucket is defined/imported
    return handleLogResult('Question', requestContext, null, result); // Ensure handleLogResult is defined/imported
}
// Using YOUR original randomBytes32
function randomBytes32(): string {
    let hex = '';
    for (let i = 0; i < 64; i++) {
        hex += Math.floor(Math.random() * 16).toString(16);
    }
    return '0x' + hex;
}

// Using YOUR original logAnswer (without validationUID)
export async function logAnswer(
    answer: string,
    answeringAgentId: string,
    requestContext: string,
    fulfillmentUID: string,
    validationUID?: string | null
): Promise<string | undefined> {
    const agentAddr =
        getAddress(answeringAgentId);
    const key = getAnswerKey(requestContext, agentAddr);
    const data: AnswerData = { // Construct the object
        answer,
        answeringAgentId: agentAddr,
        status: 'Submitted',
        timestamp: new Date().toISOString(),
        requestContext,
        fulfillmentUID: fulfillmentUID, // Use passed fulfillmentUID
        validationUID: validationUID ?? null, // Use passed validationUID
    };

    // >>> ADD DETAILED LOGGING HERE <<<
    console.log(`[Recall Service - logAnswer DEBUG] Preparing to save data for key ${key}:`, JSON.stringify(data, null, 2));
    // >>> END LOGGING <<<

    const result = await addObjectToBucket(data, key);
    return handleLogResult('Answer', requestContext, agentAddr, result);
}

/** Log the single evaluation summary for a context. */
export async function logEvaluationResult(
    evaluationData: EvaluationResult, // Kept type annotation
    requestContext: string
): Promise<string | undefined> {
    const key = getEvaluationKey(requestContext);
    const result = await addObjectToBucket(evaluationData, key);
    return handleLogResult('Evaluation', requestContext, null, result);
}

/** Log the single payout summary for a context. */
export async function logPayoutStatus(payoutStatusData: PayoutStatusData, requestContext: string): Promise<string | undefined> {
    const key = getPayoutKey(requestContext); // Ensure getPayoutKey is defined
    const dataToLog = {
        payoutAgentId: payoutStatusData.payoutAgentId,
        payoutTimestamp: payoutStatusData.payoutTimestamp || new Date().toISOString(),
        requestContext: requestContext,
        success: payoutStatusData.success,
        // truncateText is now imported and available
        message: truncateText(payoutStatusData.message, 200),
        txHashCount: Object.keys(payoutStatusData.txHashes || {}).length
    };
    const result = await addObjectToBucket(dataToLog, key); // Ensure addObjectToBucket is defined
    return handleLogResult('Payout', requestContext, null, result); // Ensure handleLogResult is defined
}

/** Log metadata about the answer evidence CAR file and deal. */
export async function logAnswerEvidence(metadata: AnswerEvidenceMetadata): Promise<string | undefined> {
    const { requestContext, answeringAgentId } = metadata;
    const agentAddr = getAddress(answeringAgentId);
    const key = getEvidenceLogKey(requestContext, agentAddr);
    const dataToLog = {
        ...metadata,
        timestamp: metadata.timestamp || new Date().toISOString(),
        submittedDealId: String(metadata.submittedDealId)
    };
    const result = await addObjectToBucket(dataToLog, key);
    return handleLogResult('AnswerEvidence', requestContext, agentAddr, result);
}

export async function getAllQuestionsForUser(theUser: string): Promise<QuestionData[]> {
    try {
      // 1) Find question keys
      //    getPendingJobs expects a "prefix" param but your code is flexible with prefix usage;
      //    If you store *all* questions under the same folder, you can pass something like `reqs/`.
      const allQuestionKeys = await getPendingJobs('reqs/');  // or simply `getPendingJobs('')`
  
      const results: QuestionData[] = [];
  
      for (const { key } of allQuestionKeys) {
        const qData = await getObjectData<QuestionData>(key);
        if (!qData) continue; // skip if not found or invalid
  
        // 2) Filter by matching user
        if (qData.user === theUser) {
          results.push(qData);
        }
      }
  
      return results;
    } catch (error: any) {
      console.error(`[Recall Service] Error fetching user questions for "${theUser}":`, error.message);
      // On error, return an empty array or rethrow as needed
      return [];
    }
  }

// --- Function for Fetching Status (Adapted for New Structure but using original payoutStatus logic) ---


export async function getRequestStatus(requestContext: string): Promise<RequestStatus | null> {
    console.log(`[Recall Service] Getting request status for context: ${requestContext}`);
    let recall: any; // Replace 'any' with actual RecallClient type if available
    let bucketAddr: Address;
    try {
        // Initialize client and find bucket address
        recall = await getRecallClient(); // Assuming this function returns the initialized client
        bucketAddr = await findLogBucketAddressOrFail(recall); // Assuming this function returns the bucket address
    }
    catch (initError: any) {
        console.error(`[Recall Service] getRequestStatus init error for ${requestContext}: ${initError.message}`);
        // Return a specific error status if initialization fails
        return { requestContext, status: 'Error', error: `Initialization failed: ${initError.message}`, submittedAt: '' };
    }

    // Define keys for the various status objects
    const questionKey = getQuestionKey(requestContext);
    const evaluationKey = getEvaluationKey(requestContext);
    const payoutKey = getPayoutKey(requestContext);
    const answerPrefix = getAnswersPrefix(requestContext);

    // Helper to fetch and parse JSON object, returning null on error/not found
    async function fetchObject<T>(key: string, maxRetries = BUCKET_ERROR, retryDelay = 1000): Promise<T | null> {
        let retries = 0;

        while (retries <= maxRetries) {
            try {
                // console.log(`[Recall Service Status] Fetching object: ${key}`);
                const { result: objectBuf } = await recall.bucketManager().get(bucketAddr, key);
                if (!objectBuf) {
                    // console.log(`[Recall Service Status] Object not found: ${key}`);
                    return null;
                }
                // Use Buffer.from for Node.js environment
                return JSON.parse(Buffer.from(objectBuf).toString('utf8')) as T;
            } catch (error: any) {
                // Don't retry on "Not Found" errors
                if (error.message?.includes('Not Found') || error.message?.includes('object not found')) {
                    // console.log(`[Recall Service Status] Object confirmed not found: ${key}`);
                    return null;
                }

                // For other errors, try to retry
                if (retries < maxRetries) {
                    console.warn(`[Recall Service Status] Fetch error for key ${key} (attempt ${retries + 1}/${maxRetries}): ${error.message?.substring(0, 150)}`);
                    retries++;

                    // Exponential backoff
                    const backoffDelay = retryDelay * Math.pow(2, retries - 1);
                    await new Promise(resolve => setTimeout(resolve, backoffDelay));
                    continue;
                }

                // Final attempt failed
                console.warn(`[Recall Service Status] All retry attempts failed for key ${key}: ${error.message?.substring(0, 150)}`);
                return null;
            }
        }

        return null;
    }
    // Using YOUR original checkAnswersExist function signature
    async function checkAnswersExist(prefix: string): Promise<boolean> {
        try {
            // console.log(`[Recall Service Status] Checking for answers with prefix: ${prefix}`);
            const { result } = await recall.bucketManager().query(bucketAddr, { prefix, limit: 1 }); // Limit 1 is enough
            return (result?.objects?.length > 0);
        } catch (error: any) {
            console.warn(`[Recall Service Status] Error querying answer prefix ${prefix}: ${error.message}`);
            return false;
        }
    }

    try {
        // Fetch all relevant status objects concurrently
        const [questionData, evaluationData, payoutData, hasAnswers] = await Promise.all([
            fetchObject<QuestionData>(questionKey),
            fetchObject<EvaluationResult>(evaluationKey),
            fetchObject<PayoutStatusData>(payoutKey), // Fetches your original summarized payout data structure
            checkAnswersExist(answerPrefix)
        ]);

        // If the question data itself doesn't exist, the request is not found
        if (!questionData) {
            console.log(`[Recall Service Status] Request context ${requestContext} not found (no question data).`);
            // Return null as per original function signature expectation
            return null;
        }

        // Determine the overall status based on the presence and state of logs
        // Start with the status recorded in the question data if available, else PendingAnswer
        let overallStatus: JobStatus = questionData.status || 'PendingAnswer';
        let errorMessage: string | undefined = undefined;

        // Refine status based on later stage logs (payout takes precedence over evaluation)
        if (payoutData) {
            // Use the 'stage' for more detail if available, otherwise map 'success'
            overallStatus = payoutData.stage === 'PayoutComplete' ? 'PayoutComplete'
                : payoutData.stage === 'PayoutAttemptedWithErrors' ? 'PayoutAttemptedWithErrors'
                    : payoutData.stage === 'FatalError' ? 'Error'
                        : payoutData.stage === 'Finalized-NoValidAnswers' ? 'NoValidAnswers' // Map finalized state
                            : payoutData.stage === 'Finalized-Error' ? 'Error' // Map finalized state
                                : payoutData.success ? 'PayoutComplete' // Fallback based on success boolean
                                    : 'Error'; // Default to Error if payout log exists but status unknown/failed
            if (!payoutData.success && overallStatus !== 'NoValidAnswers') { // Don't overwrite NoValidAnswers message
                errorMessage = payoutData.message || 'Payout process encountered errors.';
            }
        } else if (evaluationData) {
            // If no payout log, use evaluation status
            const evalStatus = evaluationData.status;
            // Map evaluation status directly to JobStatus where applicable
            if (evalStatus === 'PendingPayout' || evalStatus === 'NoValidAnswers' || evalStatus === 'Error' || evalStatus === 'PayoutComplete') {
                overallStatus = evalStatus as JobStatus; // These map directly
                if (evalStatus === 'Error') errorMessage = evaluationData.results?.find(r => r.evaluation === 'Error')?.explanation || 'Evaluation resulted in error.';
                // PayoutComplete status might be set here if payout log failed to write but eval was updated
                if (evalStatus === 'PayoutComplete') overallStatus = 'PayoutComplete';
            } else {
                // Should not happen with defined EvaluationResult statuses
                overallStatus = 'Error';
                errorMessage = `Unexpected evaluation status found: ${evalStatus}`;
                console.warn(`[Recall Service Status] ${errorMessage} for ${requestContext}`);
            }
        } else if (hasAnswers) {
            // If no eval or payout, but answers exist, it's pending evaluation
            overallStatus = 'PendingEvaluation';
        }
        // If none of the above, overallStatus remains the initial 'PendingAnswer'

        // Construct the final API response object
        const statusResult: RequestStatus = {
            requestContext: requestContext,
            status: overallStatus,
            question: questionData.question,
            cid: questionData.cid,
            submittedAt: questionData.timestamp,
            hasAnswers: hasAnswers,
            // answerCount: answerInfo.count > 0 ? answerInfo.count : undefined, // Original didn't have count
            evaluationStatus: evaluationData?.status, // Status from evaluation.json
            // --- Use payoutData.stage (string) for payoutStatus field ---
            payoutStatus: payoutData?.stage,
            // --- End change ---
            payoutMessage: payoutData?.message,
            error: errorMessage, // Include error message if applicable
            // finalVerdict: undefined // Original didn't include this
        };
        console.log(`[Recall Service Status] Final status for ${requestContext}: ${statusResult.status}`);
        return statusResult;

    } catch (error: any) {
        console.error(`[Recall Service Status] UNEXPECTED error fetching status for ${requestContext}:`, error);
        // Return a generic error status if anything unexpected happened
        return {
            requestContext: requestContext,
            status: 'Error',
            error: 'Internal error during status retrieval.',
            submittedAt: new Date().toISOString() // Provide a timestamp for the error itself
        };
    }
}

// --- Polling Function (Returns only question keys) ---
// Using YOUR original getPendingJobs
export async function getPendingJobs(prefix: string): Promise<{ key: string }[]> {
    let recall: any; let bucketAddr: Address;
    try { recall = await getRecallClient(); bucketAddr = await findLogBucketAddressOrFail(recall); }
    catch (initError: any) { console.error(`[Recall Service] getPendingJobs init error prefix ${prefix}:`, initError.message); return []; }
    try {
        const bucketManager = recall.bucketManager();
        const queryPrefix = CONTEXT_DATA_PREFIX; // Using original prefix logic
        console.log(`[Recall Service] Querying job keys with prefix: '${queryPrefix}' (non-recursive)`);
        const { result } = await bucketManager.query(bucketAddr, { prefix: queryPrefix, delimiter: '' }); // Using original query
        const objectInfos = (result?.objects ?? []);
        const questionJobKeys = objectInfos
            .map((o: any) => o.key)
            .filter((k: string | undefined): k is string => typeof k === 'string' && k.startsWith(queryPrefix) && k.endsWith('/question.json'));

        console.log(`[Recall Service] Found ${questionJobKeys.length} potential question job files.`);
        if (!questionJobKeys.length) { return []; }
        // Using original return format
        return questionJobKeys.map((key: string) => ({ key }));

    } catch (error: any) { console.error(`[Recall Service] Error polling jobs prefix ${prefix}:`, error.message); return []; }
}


// --- Helper to fetch object data ---
// Using YOUR original getObjectData
export async function getObjectData<T>(key: string): Promise<T | null> {
    let recall: any; let bucketAddr: Address;
    try { recall = await getRecallClient(); bucketAddr = await findLogBucketAddressOrFail(recall); } // findLogBucketAddressOrFail now retries
    catch (initError: any) { console.error(`[Recall Service Get] Initialization error for key ${key}:`, initError.message); return null; }

    for (let attempt = 1; attempt <= MAX_PROXY_ERROR_RETRIES; attempt++) {
        try {
            // console.log(`[Recall Service Get] Fetching object data for key: ${key} (Attempt ${attempt})`);
            const { result: objectBuf } = await recall.bucketManager().get(bucketAddr, key);
            if (!objectBuf) { return null; } // Not Found or empty
            return JSON.parse(Buffer.from(objectBuf).toString('utf8')) as T; // Success
        } catch (error: any) {
            if (error.message?.includes('Not Found') || error.message?.includes('object not found')) { return null; } // Not Found is final
            // else if (isLikelyProxyOrNetworkError(error) && attempt < MAX_PROXY_ERROR_RETRIES) { console.warn(`[Recall Service Get] Proxy/Network error fetching key ${key} (Attempt ${attempt}): ${error.message}. Retrying in ${PROXY_RETRY_DELAY_MS}ms...`); await new Promise(resolve => setTimeout(resolve, PROXY_RETRY_DELAY_MS)); continue; } // Retry
            else { console.error(`[Recall Service Get] Non-retryable error fetching key ${key} (Attempt ${attempt}): ${error.message}`); return null; } // Fail permanently
        }
    }
    console.error(`[Recall Service Get] Failed fetch key ${key} after ${MAX_PROXY_ERROR_RETRIES} attempts (proxy/network).`);
    return null;
    // --- End Retry Loop ---
}

// --- Function to Delete Object ---
// Using YOUR original deleteObject
export async function deleteObject(key: string): Promise<boolean> {
    let recall: any; let bucketAddr: Address;
    try { recall = await getRecallClient(); bucketAddr = await findLogBucketAddressOrFail(recall); await recall.bucketManager().delete(bucketAddr, key); console.log(`[Recall Service] Deleted object: ${key}`); return true; }
    catch (error: any) { if (!error.message?.includes('Not Found')) { console.error(`[Recall Service] Error deleting object ${key}:`, error.message); } return false; }
}

/**
 * Checks if there is an evaluation.json for the given request context.
 * Returns true if found, false otherwise.
 */
export async function isQuestionEvaluated(requestContext: string): Promise<boolean> {
    const evalKey = getEvaluationKey(requestContext); // e.g. 'reqs/<ctx>/evaluation.json'
    
    // Reuse your existing getObjectData<T>(key) to see if the evaluation object is there:
    const evalData = await getObjectData<EvaluationResult>(evalKey);
    return !!evalData; // if not null/undefined, means there's an evaluation
  }

// ==== ./services/recallService.ts ====