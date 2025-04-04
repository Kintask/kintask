// services/recallService.ts

import config from '../config';
import {
  RecallLogEntryData,
  RecallEventType,
  VerificationResultInternal,
} from '../types';
import { testnet } from '@recallnet/chains';
import {
  createWalletClient,
  http,
  parseEther,
  WalletClient,
  PublicClient,
  createPublicClient,
  BaseError,
  formatEther,
  Address,
} from 'viem';
import { privateKeyToAccount, Account } from 'viem/accounts';
import { truncateText } from '../utils';

/** 
 * DYNAMIC IMPORT: We'll load { RecallClient } at runtime. 
 * This helps in certain Node environments that don't allow ESM imports.
 */
async function loadRecallClientModule() {
  const mod = await import('@recallnet/sdk/client');
  return mod.RecallClient;
}

// ---------------- Module-Level State ----------------
let recallClientInstance: any = null;
let isRecallInitialized = false;
let initPromise: Promise<any> | null = null;

// Only one “log bucket” for everything:
const RECALL_BUCKET_ALIAS = 'kintask-log-bucket-v1';
let logBucketAddress: Address | null = config.recallLogBucket
  ? (config.recallLogBucket as Address)
  : null;

// Our single private key wallet
let account: Account | null = null;

// Controls concurrency for EVM nonces
let isProcessingTx = false;
const txQueue: Array<() => Promise<any>> = [];

// We remember which buckets we’ve already approved (in this runtime) so we don’t spam approvals.
const approvedBuckets = new Set<Address>();

// ----------------------------------------------------
//                 HELPER FUNCTIONS
// ----------------------------------------------------

/**
 * Create a Viem wallet client from RECALL_PRIVATE_KEY in .env
 */
function getWalletClient(): WalletClient {
  if (!config.recallPrivateKey) {
    throw new Error('No RECALL_PRIVATE_KEY found in config/.env');
  }

  const formattedPrivateKey = config.recallPrivateKey.startsWith('0x')
    ? (config.recallPrivateKey as `0x${string}`)
    : (`0x${config.recallPrivateKey}` as `0x${string}`);

  if (!account) {
    account = privateKeyToAccount(formattedPrivateKey);
    console.log(`[Recall Service] Using wallet: ${account.address} on chain: ${testnet.id}`);
  }

  return createWalletClient({
    account,
    chain: testnet,
    transport: http(),
  });
}

/**
 * Create a read-only client for awaiting transaction receipts, etc.
 */
function getPublicClient(): PublicClient {
  return createPublicClient({
    chain: testnet,
    transport: http(),
  });
}

/**
 * Singleton pattern for the RecallClient, loaded dynamically.
 */
async function getRecallClient(): Promise<any> {
  if (recallClientInstance && isRecallInitialized) {
    return recallClientInstance;
  }
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      console.log('[Recall Service] Initializing dynamic RecallClient...');
      const RecallClient = await loadRecallClientModule();

      const walletClient = getWalletClient();
      const client = new RecallClient({ walletClient });

      if (!client.walletClient.account?.address) {
        throw new Error('No wallet address after RecallClient init.');
      }
      console.log('[Recall Service] RecallClient initialized successfully.');

      recallClientInstance = client;
      isRecallInitialized = true;
      initPromise = null;
      return client;
    } catch (err: any) {
      const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
      console.error('[Recall Service] FATAL: Could not init RecallClient:', msg);

      recallClientInstance = null;
      isRecallInitialized = false;
      initPromise = null;
      throw new Error(`Recall Client init failed: ${msg}`);
    }
  })();

  return initPromise;
}

/**
 * Our transaction queue ensures we do one on-chain call at a time (nonce mgmt).
 */
async function processTxQueue<T>(txFunction: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const runTx = async () => {
      if (isProcessingTx) {
        txQueue.push(runTx);
        return;
      }
      isProcessingTx = true;
      try {
        const result = await txFunction();
        resolve(result);
      } catch (err: any) {
        const errMsg = err?.shortMessage || err?.message || String(err);
        console.error('[Recall Tx Queue] Tx error:', errMsg.split('\n')[0]);
        reject(err);
      } finally {
        isProcessingTx = false;
        const nextTx = txQueue.shift();
        if (nextTx) {
          console.log(`[Recall Tx Queue] Next tx in queue... (${txQueue.length} left)`);
          setImmediate(() => {
            nextTx().catch((queueError) => {
              const qErrMsg = queueError?.shortMessage || queueError?.message || String(queueError);
              console.error('[Recall Tx Queue] Error processing subsequent tx:', qErrMsg);
            });
          });
        }
      }
    };

    if (!isProcessingTx && txQueue.length === 0) {
      runTx();
    } else {
      console.log(`[Recall Tx Queue] Queueing tx (new size: ${txQueue.length + 1})...`);
      txQueue.push(runTx);
    }
  });
}

/**
 * Check credit balance. If zero, buy 1 RTC credit. 
 * (One credit can let you store multiple small objects, so you may consider buying more if you do many writes.)
 */
async function ensureCreditBalance(recall: any) {
  console.log('[Recall Service] Checking credit balance...');
  const creditManager = recall.creditManager();
  const { result: creditBalance } = await creditManager.getCreditBalance();

  const creditFree = creditBalance?.creditFree ?? 0n;
  console.log(`[Recall Service] creditFree: ${formatEther(creditFree)} RTC`);

  if (creditFree === 0n) {
    console.log('[Recall Service] credit_free == 0, buying 1 RTC...');
    const txHash = await processTxQueue(async () => {
      const { meta } = await creditManager.buy(parseEther('1'));
      return meta?.tx?.transactionHash;
    });

    if (!txHash) throw new Error('Credit buy transaction returned no hash.');
    console.log(`[Recall Service] buy(1 RTC) => txHash=${txHash}. Waiting receipt...`);

    const receipt = await getPublicClient().waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') {
      throw new Error(`Credit buy failed. Tx status: ${receipt.status}`);
    }
    console.log('[Recall Service] Credits purchased successfully.');
  } else {
    console.log('[Recall Service] Sufficient credits. No purchase needed.');
  }
}

/**
 * Ensure we have approved the given bucket to consume your credits. 
 * We store the result in `approvedBuckets` so we only do it once per bucket in this runtime.
 */
async function ensureBucketApproval(recall: any, bucketAddress: Address) {
  if (approvedBuckets.has(bucketAddress)) {
    // Already approved in this session
    return;
  }
  console.log('[Recall Service] Checking credit approval for bucket:', bucketAddress);

  const creditManager = recall.creditManager();
  const selfAddr = recall.walletClient.account?.address;
  if (!selfAddr) throw new Error('No wallet address in recall client?');

  // See if we've previously approved this bucket. If not, do so once.
  const { result: acctInfo } = await creditManager.getAccount(selfAddr);
  const alreadyApproved = acctInfo?.approvalsTo?.some(
    (appr: any) => appr.addr.toLowerCase() === bucketAddress.toLowerCase()
  );

  if (alreadyApproved) {
    console.log(`[Recall Service] Bucket ${bucketAddress} already approved.`);
  } else {
    console.log(`[Recall Service] Approving bucket ${bucketAddress}...`);
    const txHash = await processTxQueue(async () => {
      const { meta } = await creditManager.approve(bucketAddress, [], 0n, 0n, 0n);
      return meta?.tx?.transactionHash;
    });
    if (!txHash) {
      throw new Error('Bucket approval tx returned no hash.');
    }
    console.log(`[Recall Service] Approve tx sent: ${txHash}. Waiting on receipt...`);
    const receipt = await getPublicClient().waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') {
      throw new Error(`Bucket approval failed. Tx status: ${receipt.status}`);
    }
    console.log('[Recall Service] Bucket approval confirmed on-chain.');
  }

  approvedBuckets.add(bucketAddress);
}

/**
 * Ensure we have a single "log bucket". We do not create multiple.
 * If we already know `logBucketAddress`, use it. Otherwise, create or find by alias.
 */
async function ensureLogBucket(recall: any): Promise<Address> {
  if (logBucketAddress) {
    return logBucketAddress;
  }

  console.log(`[Recall Service] Checking for log bucket with alias="${RECALL_BUCKET_ALIAS}"...`);
  const bucketManager = recall.bucketManager();

  // List all known buckets
  const { result: listRes } = await bucketManager.list();
  const allBuckets = listRes?.buckets ?? [];
  let foundAddr: Address | undefined;

  // Check each bucket's metadata to see if it has our alias
  for (const b of allBuckets) {
    try {
      const metaRes = await bucketManager.getMetadata(b);
      if (metaRes.result?.metadata?.alias === RECALL_BUCKET_ALIAS) {
        foundAddr = b;
        break;
      }
    } catch {
      /* ignore fetch errors */
    }
  }

  if (foundAddr) {
    console.log('[Recall Service] Found existing log bucket:', foundAddr);
    logBucketAddress = foundAddr;
    return foundAddr;
  }

  // Not found => create
  console.log('[Recall Service] No log bucket found. Creating a new one...');
  await ensureCreditBalance(recall);

  const createResult = await processTxQueue(async () => {
    const { result, meta } = await bucketManager.create({
      metadata: {
        alias: RECALL_BUCKET_ALIAS,
        createdBy: 'KintaskBackend',
        timestamp: new Date().toISOString(),
      },
    });
    return { bucket: result?.bucket as Address, txHash: meta?.tx?.transactionHash };
  });

  if (!createResult.bucket) {
    throw new Error('Bucket creation returned no address.');
  }
  console.log(`[Recall Service] Created bucket: ${createResult.bucket} (txHash=${createResult.txHash})`);
  console.warn(`Please update .env with RECALL_LOG_BUCKET=${createResult.bucket}`);

  logBucketAddress = createResult.bucket;
  return logBucketAddress;
}

// ----------------------------------------------------
//                PUBLIC SERVICE FUNCTIONS
// ----------------------------------------------------

/**
 * Add an object to our single "log bucket" in one transaction.
 * This is the main function that actually writes on-chain.
 */
export async function addObjectToBucket(
  dataObject: object,
  key: string
): Promise<{
  success: boolean;
  bucket?: string;
  key?: string;
  txHash?: string;
  error?: string;
}> {
  // Optional short-circuit for dev
  if (process.env.MOCK_RECALL === 'true') {
    console.log(`[Recall Service MOCK] addObjectToBucket: key=${key}`);
    return {
      success: true,
      bucket: '0xmockBucket',
      key,
      txHash: '0xmockTxHash',
    };
  }

  let recall: any;
  let bucketAddr: Address;
  try {
    // 1) Recall client
    recall = await getRecallClient();
    // 2) Ensure log bucket
    bucketAddr = await ensureLogBucket(recall);
    // 3) Ensure credit & approval for that bucket
    await ensureCreditBalance(recall);
    await ensureBucketApproval(recall, bucketAddr);
  } catch (setupError: any) {
    const errMsg = setupError?.message?.split('\n')[0] || String(setupError);
    console.error('[Recall Setup Error] addObjectToBucket:', errMsg);
    return { success: false, error: `Setup failed: ${errMsg}` };
  }

  console.log(`[Recall Service] Storing object => Bucket: ${bucketAddr}, Key: ${truncateText(key, 60)}`);
  try {
    const contentStr = JSON.stringify(dataObject);
    const fileBuffer = Buffer.from(contentStr, 'utf8');

    // 4) Do the actual add
    const txHash = await processTxQueue(async () => {
      const { meta } = await recall.bucketManager().add(bucketAddr, key, fileBuffer);
      return meta?.tx?.transactionHash;
    });

    if (!txHash) {
      console.warn('[Recall Service] addObjectToBucket ended with no txHash (?), returning success anyway.');
      return { success: true, bucket: bucketAddr, key };
    }
    console.log(`[Recall Service] Object stored. Key=${key}, tx=${txHash.slice(0, 20)}...`);

    return { success: true, bucket: bucketAddr, key, txHash };
  } catch (err: any) {
    let conciseError = `Failed adding object (key=${truncateText(key, 30)})`;
    if (err instanceof BaseError) {
      conciseError = err.shortMessage || err.message.split('\n')[0];
    } else if (err instanceof Error) {
      conciseError = err.message.split('\n')[0];
    } else {
      conciseError = String(err);
    }

    // Possibly parse error messages for "insufficient funds" or "approval not found"...
    console.error('[Recall Service] addObjectToBucket error:', conciseError);
    return { success: false, error: conciseError };
  }
}

/**
 * Example function: Log a CRITICAL error event. 
 * If called often, it can get expensive (one transaction each call). 
 * To optimize, you might store multiple errors in memory and call addObjectToBucket() once with a batch.
 */
export async function logErrorEvent(
  details: Record<string, any>,
  requestContext: string
): Promise<string | undefined> {
  if (process.env.MOCK_RECALL === 'true') {
    console.log('[Recall Service MOCK] logErrorEvent for requestContext:', requestContext);
    return '0xmock_error_tx';
  }
  if (!requestContext) {
    console.error('[Recall Service] logErrorEvent missing requestContext');
    return undefined;
  }

  const logEntry = {
    timestamp: new Date().toISOString(),
    type: 'VERIFICATION_ERROR' as RecallEventType,
    details,
    requestContext,
  };

  const timeSfx = logEntry.timestamp.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
  const key = `${requestContext}/ERROR_${details.stage || 'Unknown'}_${timeSfx}.json`;

  const result = await addObjectToBucket(logEntry, key);
  if (!result.success) {
    console.error('[Recall Service] Could not log error event:', result.error);
    return undefined;
  }
  console.log('[Recall Service] Logged error event, txHash=', result.txHash);
  return result.txHash;
}

/**
 * Example function: Log the final verification trace. 
 * Again, this is a separate on-chain call. Combine if you want fewer writes.
 */
export async function logFinalVerificationTrace(
  requestContext: string,
  verificationResult: VerificationResultInternal
): Promise<string | undefined> {
  if (process.env.MOCK_RECALL === 'true') {
    console.log('[Recall Service MOCK] logFinalVerificationTrace, context=', requestContext);
    return '0xmock_final_tx';
  }
  if (!requestContext || !verificationResult) {
    console.error('[Recall Service] Missing context or result for final batch log.');
    return undefined;
  }

  const isError = verificationResult.finalVerdict.startsWith('Error:');
  const logType: RecallEventType = isError ? 'VERIFICATION_ERROR' : 'VERIFICATION_COMPLETE';

  const finalLogObject = {
    timestamp: new Date().toISOString(),
    type: logType,
    requestContext,
    finalVerdict: verificationResult.finalVerdict,
    finalConfidence: verificationResult.confidenceScore,
    timelockRequestId: verificationResult.timelockRequestId,
    timelockCommitTxHash: verificationResult.timelockCommitTxHash,
    usedEvidenceCids: verificationResult.usedFragmentCids,
    fullTrace: verificationResult.reasoningSteps,
  };

  const timeSfx = finalLogObject.timestamp.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
  const key = `${requestContext}/FINAL_TRACE_${logType}_${timeSfx}.json`;

  const result = await addObjectToBucket(finalLogObject, key);
  if (!result.success) {
    console.error('[Recall Service] Could not log final trace:', result.error);
    return undefined;
  }
  console.log('[Recall Service] Final batch trace logged, txHash=', result.txHash);
  return result.txHash;
}

/**
 * Example function to read back logs from the single log bucket. 
 * If you only do a single “batch” write, you can parse them in one go, 
 * but here we do a simple prefix query and fetch each .json.
 */
export async function getTraceFromRecall(
  requestContext: string
): Promise<RecallLogEntryData[]> {
  if (process.env.MOCK_RECALL === 'true') {
    console.log('[Recall Service MOCK] getTraceFromRecall => returns empty');
    return [];
  }
  if (!requestContext) return [];

  console.log('[Recall Service] getTraceFromRecall, prefix=', requestContext);
  let recall: any;
  let bucketAddr: Address;

  try {
    recall = await getRecallClient();
    bucketAddr = await ensureLogBucket(recall);
  } catch (initError) {
    const msg = initError instanceof Error
      ? initError.message.split('\n')[0]
      : String(initError);
    console.error('[Recall Service] getTraceFromRecall init error:', msg);
    return [];
  }

  try {
    const bucketManager = recall.bucketManager();
    const prefix = `${requestContext}/`;

    const { result: qRes } = await bucketManager.query(bucketAddr, {
      prefix,
      delimiter: '',
    });

    // Filter to .json keys
    const objectKeys = (qRes?.objects ?? [])
      .map((o: any) => o.key)
      .filter((k: string | undefined) => k && k.endsWith('.json')) as string[];

    if (!objectKeys.length) {
      console.log('[Recall Service] No .json objects found with prefix:', prefix);
      return [];
    }

    console.log(`[Recall Service] Found ${objectKeys.length} objects; fetching each...`);
    const fetchPromises = objectKeys.map(async (key) => {
      try {
        const { result: objBuf } = await bucketManager.get(bucketAddr, key);
        if (!objBuf) return null;

        const buf = Buffer.from(objBuf as Uint8Array);
        const text = buf.toString('utf8');
        try {
          const parsed = JSON.parse(text);
          // If it has a "fullTrace" array, that might be the final batch. 
          if (Array.isArray(parsed.fullTrace)) {
            // Return that array so we can flatten 
            return parsed.fullTrace as RecallLogEntryData[];
          } else {
            // Possibly a single log
            return [parsed as RecallLogEntryData];
          }
        } catch (parseErr) {
          console.warn('[Recall Service] JSON parse error for key=', key, parseErr);
          return null;
        }
      } catch (err) {
        console.warn('[Recall Service] getTraceFromRecall fetch error, key=', key, err);
        return null;
      }
    });

    const nested = (await Promise.all(fetchPromises)).filter(Boolean) as RecallLogEntryData[][];
    const flat = nested.flat().sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    console.log(`[Recall Service] Fetched ${flat.length} trace items total.`);
    return flat;
  } catch (err) {
    console.error('[Recall Service] Error querying/fetching logs:', String(err));
    return [];
  }
}
