// recall.service.ts
import config from '../config';
import { RecallLogEntryData, RecallEventType } from '../types';
import { testnet } from '@recallnet/chains'; // Use the testnet chain definition
import { createWalletClient, http, parseEther, WalletClient, PublicClient, createPublicClient, ChainMismatchError } from 'viem';
import { privateKeyToAccount, Account } from 'viem/accounts';
// Assuming named exports based on example structure
import { RecallClient } from '@recallnet/sdk/client'; // Removed BucketManager import

// --- Module State ---
let recallClientInstance: RecallClient | null = null;
let isRecallInitialized = false;
let logBucketAddress = config.recallLogBucket || null; // Store the bucket address globally
let account: Account | null = null;
const RECALL_BUCKET_ALIAS = 'kintask-log-bucket-v1'; // Unique alias for this project's log bucket
let initPromise: Promise<RecallClient> | null = null; // To handle concurrent initializations

// --- Helper: Create Viem Wallet Client ---
function getWalletClient(): WalletClient {
    if (!config.recallPrivateKey) {
        throw new Error('Recall Private Key (PRIVATE_KEY in .env) is not configured.');
    }
    const formattedPrivateKey = config.recallPrivateKey.startsWith('0x')
        ? config.recallPrivateKey as `0x${string}`
        : `0x${config.recallPrivateKey}` as `0x${string}`;

    if (!account) { // Cache the account object
         account = privateKeyToAccount(formattedPrivateKey);
         console.log(`[Recall Service] Using wallet address: ${account.address} on chain ${testnet.id}`);
    }

    // Ensure the transport is configured for the correct chain
    return createWalletClient({
        account: account,
        chain: testnet, // Explicitly set Recall testnet chain
        transport: http(), // Default HTTP transport - Add RPC URL from testnet config if needed explicitly
                          // transport: http(testnet.rpcUrls.default.http[0]),
    });
}

 // --- Helper: Create Viem Public Client ---
 function getPublicClient(): PublicClient {
     return createPublicClient({
         chain: testnet, // Use Recall testnet chain
         transport: http(),
     });
 }


// --- Helper: Get or Initialize Recall Client (Singleton Pattern) ---
async function getRecallClient(): Promise<RecallClient> {
    if (recallClientInstance && isRecallInitialized) {
        return recallClientInstance;
    }
    // Prevent race conditions during initialization
    if (initPromise) {
        return initPromise;
    }

    initPromise = (async () => {
        console.log("[Recall Service] Initializing Recall Client (getRecallClient)...");
        try {
            const walletClient = getWalletClient(); // Get viem wallet client configured for Recall testnet
            const client = new RecallClient({ walletClient });

            // Basic check: Ensure client has account after initialization
            if (!client.walletClient.account?.address) {
                throw new Error("Failed to initialize client: Wallet address missing.");
            }
            console.log("[Recall Service] Recall Client Initialized successfully.");
            recallClientInstance = client;
            isRecallInitialized = true; // Mark as initialized
            initPromise = null; // Clear promise
            return client;
        } catch (error: any) {
            console.error("[Recall Service] FATAL ERROR initializing Recall Client:", error.message);
            recallClientInstance = null;
            isRecallInitialized = false;
            initPromise = null;
            throw new Error(`Recall Client initialization failed: ${error.message}`); // Rethrow to calling function
        }
    })();

    return initPromise;
}

// --- Helper: Ensure Credit Balance ---
// Returns true if credit was sufficient OR successfully purchased, false otherwise
async function ensureCreditBalanceIfZero(recall: RecallClient): Promise<boolean> {
    console.log("[Recall Service] Checking credit balance...");
    try {
        const creditManager = recall.creditManager();
        const { result: creditBalance } = await creditManager.getCreditBalance();
        const creditFree = creditBalance?.creditFree ?? 0n;
        console.log(`[Recall Service] Current credit_free: ${creditFree.toString()}`);

        if (creditFree === 0n) { // Only buy if exactly zero
            console.log('[Recall Service] credit_free is 0, attempting to buy 1 credit...');
            const amountToBuy = parseEther("1");
            const { meta } = await creditManager.buy(amountToBuy);
            const txHash = meta?.tx?.transactionHash;
            if (!txHash) throw new Error("Credit purchase transaction did not return a hash.");

            console.log(`[Recall Service] Credit purchase transaction sent: ${txHash}. Waiting for confirmation...`);
            const publicClient = getPublicClient();
            const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });

            if (receipt.status === 'success') {
                 console.log(`[Recall Service] Credit purchased successfully (Tx: ${txHash}).`);
                 await new Promise(resolve => setTimeout(resolve, 3000)); // Allow buffer time
                 return true;
            } else {
                 console.error(`[Recall Service] Credit purchase transaction failed (Tx: ${txHash}). Status: ${receipt.status}`);
                 throw new Error(`Failed to purchase Recall credit (Tx: ${txHash}, Status: ${receipt.status}).`);
            }
        }
        return true; // Credit was > 0 initially
    } catch (error: any) {
        console.error("[Recall Service] Error checking or buying credit:", error.message);
         if (error instanceof ChainMismatchError) {
              console.error("[Recall Service] Chain mismatch detected. Check Recall SDK/Chain config.");
         }
        // Rethrow or return false to indicate failure? Let's rethrow for clarity.
        throw new Error(`Failed to ensure Recall credit balance: ${error.message}`);
    }
}

// --- Helper: Find or Create Log Bucket ---
async function ensureLogBucket(recall: RecallClient): Promise<string> {
    if (logBucketAddress) {
        return logBucketAddress;
    }

    console.log(`[Recall Service] Attempting to find or create log bucket with alias: ${RECALL_BUCKET_ALIAS}`);
    const bucketManager = recall.bucketManager();
    let foundBucket: string | null = null;

    try {
        const { result: listResult } = await bucketManager.list();
        const buckets = listResult?.buckets || [];
        console.log(`[Recall Service] Checking ${buckets.length} accessible buckets for alias...`);

        for (const bucketAddr of buckets) {
            try {
                // list returns { kind: string, addr: string, metadata: Record<string, unknown> }[]
                // No need to call getMetadata separately if list returns it
                if (bucketAddr.metadata?.alias === RECALL_BUCKET_ALIAS) {
                    console.log(`[Recall Service] Found existing log bucket: ${bucketAddr.addr}`);
                    foundBucket = bucketAddr.addr;
                    break;
                }
            } catch (listError: any) { /* Handle specific list errors if needed */ }
        }

        if (!foundBucket) {
            console.log(`[Recall Service] Log bucket alias '${RECALL_BUCKET_ALIAS}' not found. Creating new bucket...`);
            await ensureCreditBalanceIfZero(recall); // Ensure credit before creating

            const createMetaPayload = { alias: RECALL_BUCKET_ALIAS, createdBy: 'KintaskBackend', timestamp: new Date().toISOString() };
            const { result, meta: createMetaInfo } = await bucketManager.create({ metadata: createMetaPayload });
            foundBucket = result?.bucket;
            const createTxHash = createMetaInfo?.tx?.transactionHash;

            if (foundBucket) {
                 console.log(`[Recall Service] Successfully created new log bucket: ${foundBucket} (Tx: ${createTxHash})`);
                 console.warn(`ACTION REQUIRED: Consider adding/updating RECALL_LOG_BUCKET in .env to: ${foundBucket} for faster startup.`);
            } else {
                 const errorMsg = createMetaInfo?.error?.message || "Bucket creation call succeeded but no bucket address was returned.";
                 console.error("[Recall Service] Bucket creation failed:", errorMsg, createMetaInfo);
                 throw new Error(errorMsg);
            }
        }

        logBucketAddress = foundBucket; // Cache address
        return logBucketAddress;

    } catch (error: any) {
        console.error("[Recall Service] Error finding or creating log bucket:", error.message);
        throw new Error(`Failed to ensure Recall log bucket: ${error.message}`);
    }
}

// --- Main Logging Function ---
export async function logRecallEvent(
    type: RecallEventType,
    details: Record<string, any>,
    requestContext: string
): Promise<string | undefined> { // Returns Recall Tx Hash or undefined

    if (!requestContext) {
         console.error("[Recall Service] CRITICAL: logRecallEvent called without requestContext.");
         return undefined;
    }

    let recall: RecallClient;
    let bucketAddr: string;
    try {
        // Get client, bucket, and ensure credit *before* creating log entry object
        recall = await getRecallClient();
        bucketAddr = await ensureLogBucket(recall);
        await ensureCreditBalanceIfZero(recall);
    } catch (setupError: any) {
        console.error(`[Recall Service] Setup failed before logging event ${type} (Context: ${requestContext}):`, setupError.message);
        return undefined; // Cannot log if setup fails
    }

    const logEntry: RecallLogEntryData = {
        timestamp: new Date().toISOString(),
        type: type,
        details: details,
        requestContext: requestContext,
    };

    // Prepare data for storage
    const contentString = JSON.stringify(logEntry);
    const fileBuffer = Buffer.from(contentString, 'utf8');
    const timestampSuffix = logEntry.timestamp.replace(/[:.]/g, '-');
    const key = `${requestContext}/${timestampSuffix}_${type}.json`; // Structure logs by request context

    // console.log(`[Recall Service] Logging Event [${requestContext}] Type=${type} to Bucket ${bucketAddr.substring(0,10)}... Key=${key.substring(0,50)}...`);

    try {
        const bucketManager = recall.bucketManager();
        const { meta } = await bucketManager.add(bucketAddr, key, fileBuffer);
        const txHash = meta?.tx?.transactionHash;

        if (!txHash) {
             console.warn(`[Recall Service] Log add successful (according to SDK meta?) for context ${requestContext}, type ${type}, but no txHash returned. Status uncertain.`);
             // Check meta for other status info if available
             return undefined;
        }

        console.log(`[Recall Service] Log Event ${type} stored for context ${requestContext}. TxHash: ${txHash}`);
        return txHash;

    } catch (error: any) {
        console.error(`[Recall Service] Error adding log event ${type} for context ${requestContext} to bucket ${bucketAddr}:`, error.message);
        return undefined; // Indicate logging failure
    }
}

// --- Trace Retrieval Function ---
export async function getTraceFromRecall(requestContext: string): Promise<RecallLogEntryData[]> {
    if (!requestContext) return [];

    console.log(`[Recall Service] Retrieving trace for context: ${requestContext}`);
    let recall: RecallClient;
    let bucketAddr: string;
    try {
        recall = await getRecallClient();
        // Use cached bucket address if available, otherwise ensure it exists
        bucketAddr = logBucketAddress || await ensureLogBucket(recall);
    } catch (initError: any) {
         console.error(`[Recall Service] Initialization failed for retrieving trace (Context: ${requestContext}):`, initError.message);
         return [];
    }

    try {
        const bucketManager = recall.bucketManager();
        const prefix = `${requestContext}/`; // Query by the context "folder"

        console.log(`[Recall Service] Querying bucket ${bucketAddr.substring(0,10)}... for prefix: ${prefix}`);
        const { result: queryResult } = await bucketManager.query(bucketAddr, { prefix: prefix, delimiter: '' });

        const objectInfos = (queryResult?.objects || []);
        const objectKeys = objectInfos.map(obj => obj.key).filter((k): k is string => !!k && k.endsWith('.json'));

        if (objectKeys.length === 0) {
            console.log(`[Recall Service] No log entries found via query for context: ${requestContext}`);
            return [];
        }
        console.log(`[Recall Service] Found ${objectKeys.length} log keys for context ${requestContext}. Fetching content...`);

        // Fetch content concurrently
        const fetchPromises = objectKeys.map(async (key) => {
             try {
                 const { result: objectResult } = await bucketManager.get(bucketAddr, key);
                 const objectBuf = objectResult as Uint8Array | null; // SDK's get returns Uint8Array
                 if (!objectBuf) {
                     console.warn(`[Recall Service] Got null buffer for key ${key}`);
                     return null;
                 }
                 // Ensure it's a Buffer before decoding (Node.js Buffer handles Uint8Array)
                 const buffer = Buffer.from(objectBuf);
                 const textContent = buffer.toString('utf8');
                 const logEntry = JSON.parse(textContent) as RecallLogEntryData;
                 if (logEntry && logEntry.timestamp && logEntry.type && logEntry.details) {
                      return logEntry;
                 }
                 console.warn(`[Recall Service] Invalid log format found parsing key ${key}`);
                 return null;
             } catch (fetchError: any) {
                  console.error(`[Recall Service] Error fetching/parsing key ${key}: ${fetchError.message}`);
                   if (fetchError.message?.includes("Object not found")) {
                        console.warn(`   -> Object likely deleted or query/get mismatch for key ${key}`);
                   }
                  return null;
             }
        });

        const logEntries = (await Promise.all(fetchPromises))
                            .filter((entry): entry is RecallLogEntryData => entry !== null)
                            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()); // Sort chronologically

         console.log(`[Recall Service] Successfully retrieved and parsed ${logEntries.length} log entries for context: ${requestContext}`);
         return logEntries;

    } catch (error: any) {
        console.error(`[Recall Service] Error retrieving trace for context ${requestContext}:`, error.message);
        return []; // Return empty trace on error
    }
}

// Removed duplicate declaration: let logBucketAddress = config.recallLogBucket || null;