import { ethers, Wallet, Contract, AbiCoder, keccak256, getBytes, TransactionResponse, TransactionReceipt, Log, EventLog, JsonRpcProvider, Interface } from 'ethers';
import { Blocklock, encodeCiphertextToSolidity, TypesLib } from 'blocklock-js';
import config from '../config';
import KintaskCommitmentAbi from '../contracts/abi/KintaskCommitment.json'; // ABI loaded in server.ts, ensure it's valid there
import { KINTASK_COMMITMENT_CONTRACT_ADDRESS } from '../contracts/addresses';
import { logRecallEvent } from './recallService'; // Import recall logger for reveal events

interface CommitResult {
    requestId: string; // The on-chain request ID from Blocklock
    txHash: string; // The L2 transaction hash
    ciphertextHash: string; // Hash of the encrypted data 'v' field
}

// --- State Variables ---
let provider: JsonRpcProvider | null = null;
let wallet: Wallet | null = null;
let blocklockJsInstance: Blocklock | null = null;
let commitmentContract: Contract | null = null;
let commitmentContractInterface: Interface | null = null;
let isTimelockInitialized = false;
let revealListenerAttached = false;
let currentListener: ethers.Listener | null = null; // Store the listener function itself

// Simple mapping to associate blocklock request ID with our internal request context for logging reveals
const blocklockIdToRequestContext = new Map<string, string>(); // blocklockRequestId -> requestContext
const MAX_CONTEXT_MAP_SIZE = 1000; // Limit map size

// --- Initialization ---
export function initializeTimelockService() {
    if (isTimelockInitialized) {
        console.log("[Timelock Service] Already initialized.");
        return;
    }
    console.log("[Timelock Service] Initializing...");
    try {
        // Config presence is checked in config.ts and ABI in server.ts
        provider = new ethers.JsonRpcProvider(config.l2RpcUrl, undefined, { staticNetwork: true }); // Optimize provider
        wallet = new Wallet(config.walletPrivateKey, provider);

        // Initialize Blocklock SDK
        if (!config.blocklockSenderProxyAddress) throw new Error("BLOCKLOCK_SENDER_PROXY_ADDRESS missing");
        blocklockJsInstance = new Blocklock(wallet, config.blocklockSenderProxyAddress);

        // Initialize Contract instance
        if (!KINTASK_COMMITMENT_CONTRACT_ADDRESS) throw new Error("KINTASK_CONTRACT_ADDRESS missing");
        if (!KintaskCommitmentAbi || !KintaskCommitmentAbi.abi || (KintaskCommitmentAbi as any)._comment) {
            // This check is also in server.ts, but good to have defensively here too
             throw new Error("KintaskCommitment ABI missing, invalid or placeholder");
        }
        commitmentContract = new Contract(KINTASK_COMMITMENT_CONTRACT_ADDRESS, KintaskCommitmentAbi.abi, wallet);
        commitmentContractInterface = commitmentContract.interface; // Store interface for parsing logs

        // Basic connectivity check (async, non-blocking for startup speed)
        provider.getNetwork().then(network => {
            console.log(`[Timelock Service] Connected to network: ${network.name} (Chain ID: ${network.chainId})`);
            // Validate proxy address known by SDK for this network? (If SDK provides such check)
        }).catch(err => console.error("[Timelock Service] Failed initial network check:", err.message));

        commitmentContract.getAddress().then(address => {
              console.log(`[Timelock Service] KintaskCommitment contract instance target: ${address}`);
              // Optional: Call a view function on the contract to confirm connection?
              // commitmentContract.nextRequestIdInternal().then(id => console.log(`[Timelock Service] Contract view function check ok (nextRequestIdInternal: ${id})`)).catch(err => console.error("[Timelock Service] Failed contract view function check:", err.message));
         }).catch(err => console.error("[Timelock Service] Failed to get KintaskCommitment contract address (check deployment and config):", err.message));

        isTimelockInitialized = true;
        console.log("[Timelock Service] Initialization complete. Starting reveal listener...");

        // Start listener automatically after successful initialization
        startRevealListener();

    } catch (error: any) {
         console.error("[Timelock Service] FATAL Initialization failed:", error.message);
         isTimelockInitialized = false;
         // Consider if the backend should exit if timelock fails to initialize
         // process.exit(1);
    }
}


// --- Commit Function ---
export async function commitVerdictTimelocked(
    verdictToEncrypt: string, // The string to encrypt and commit
    delayInBlocks: number = 5, // Default delay
    requestContext: string // MUST be provided for mapping reveals
): Promise<CommitResult | null> {

    if (!isTimelockInitialized || !blocklockJsInstance || !commitmentContract || !provider || !wallet || !commitmentContractInterface) {
        console.error('[Timelock Service] Service not initialized properly. Cannot commit verdict.');
        // Log only if context is available, otherwise the error is initialization-related
        if(requestContext) {
            await logRecallEvent('TIMELOCK_COMMIT_FAILURE', { error: 'Service not initialized', requestContext }, requestContext);
        }
        return null;
    }
    if (!requestContext) {
        console.error('[Timelock Service] Request context must be provided to commitVerdictTimelocked for reveal mapping.');
         // Avoid logging event here as we don't have context!
        return null;
    }

    let txResponse: TransactionResponse | null = null;
    try {
        const currentBlockNumber = await provider.getBlockNumber();
        // Ensure delay is positive, add small buffer?
        const targetBlock = currentBlockNumber + Math.max(1, delayInBlocks);
        const decryptionBlockNumber = BigInt(targetBlock);
        console.log(`[Timelock Service Context: ${requestContext}] Current Block: ${currentBlockNumber}, Decryption Block Target: ${decryptionBlockNumber}`);

        // 1. Encode verdict string to bytes
        const encoder = AbiCoder.defaultAbiCoder();
        const encodedVerdictBytes = encoder.encode(['string'], [verdictToEncrypt]);
        // const encodedVerdictBytes = ethers.toUtf8Bytes(verdictToEncrypt); // Alternative simple encoding

        // 2. Encrypt using blocklock-js
        console.log(`[Timelock Service Context: ${requestContext}] Encrypting verdict "${verdictToEncrypt.substring(0, 50)}..."`);
        const ciphertext: TypesLib.Ciphertext = blocklockJsInstance.encrypt(getBytes(encodedVerdictBytes), decryptionBlockNumber);
        const solidityCiphertext = encodeCiphertextToSolidity(ciphertext);
        const ciphertextHash = keccak256(solidityCiphertext.v); // Hash the main encrypted payload
        console.log(`[Timelock Service Context: ${requestContext}] Ciphertext Hash: ${ciphertextHash}`);

        // 3. Call commitVerdict on contract
        console.log(`[Timelock Service Context: ${requestContext}] Sending commitVerdict transaction...`);
        // Estimate gas? Add nonce management? For hackathon, keep simple.
        txResponse = await commitmentContract.commitVerdict(
            decryptionBlockNumber,
            solidityCiphertext
            // Optional: Add gas overrides { gasLimit: ..., maxFeePerGas: ... }
        );
        console.log(`[Timelock Service Context: ${requestContext}] Commit transaction sent. Hash: ${txResponse.hash}. Waiting for confirmation...`);
        const receipt: TransactionReceipt | null = await txResponse.wait(1); // Wait for 1 confirmation

        if (!receipt) {
            throw new Error(`Commit transaction ${txResponse.hash} confirmation timed out or receipt was null.`);
        }
        console.log(`[Timelock Service Context: ${requestContext}] Commit Tx Confirmed. Status: ${receipt.status}, Block: ${receipt.blockNumber}, Gas Used: ${receipt.gasUsed}`);
        if (receipt.status !== 1) {
             // Try to get revert reason (may not always work)
             let revertReason = "Transaction reverted on-chain";
             try {
                 // Replay the transaction call at the block before it was mined to get revert reason
                 // Note: This might fail if state changed significantly or on certain nodes
                 await provider.call({ ...txResponse, from: wallet.address, blockTag: receipt.blockNumber - 1 });
             } catch (revertError: any) {
                 if (revertError.data) {
                     try {
                         revertReason = commitmentContractInterface.parseError(revertError.data)?.name ?? revertReason;
                     } catch { /* Ignore parsing error */ }
                 } else if (revertError.message) {
                     revertReason = revertError.message;
                 }
             }
            throw new Error(`Commit transaction ${txResponse.hash} failed on-chain (Status: 0). Reason: ${revertReason}`);
        }

        // 4. Parse Blocklock Request ID from logs using the Interface
        const eventSignature = "VerdictCommitted(uint256,address,uint256,bytes32)";
        const eventTopic = commitmentContractInterface.getEvent(eventSignature)?.topicHash;
        if (!eventTopic) throw new Error("Could not get topic hash for VerdictCommitted event");

        const log = receipt.logs.find((l: Log) =>
            l.topics[0] === eventTopic && l.address.toLowerCase() === KINTASK_COMMITMENT_CONTRACT_ADDRESS.toLowerCase()
        );

        if (!log) {
            console.error("[Timelock Service] Receipt logs:", JSON.stringify(receipt.logs, null, 2));
            throw new Error(`Could not find VerdictCommitted event log in transaction receipt for ${txResponse.hash}.`);
        }

        const decodedLog = commitmentContractInterface.parseLog({ topics: [...log.topics], data: log.data });
        const blocklockRequestId = decodedLog?.args.blocklockRequestId?.toString();
        if (!blocklockRequestId) {
            throw new Error('Failed to decode Blocklock Request ID from VerdictCommitted event.');
        }

        console.log(`[Timelock Service Context: ${requestContext}] Successfully committed. Blocklock Request ID: ${blocklockRequestId}`);

        // Store the mapping for the listener (handle potential map growth)
        if (blocklockIdToRequestContext.size >= MAX_CONTEXT_MAP_SIZE) {
             // Simple eviction: remove the first entry iterated (likely oldest)
             const oldestKey = blocklockIdToRequestContext.keys().next().value;
             if (oldestKey) blocklockIdToRequestContext.delete(oldestKey);
             console.warn(`[Timelock Service] Context map reached max size (${MAX_CONTEXT_MAP_SIZE}), evicted oldest entry.`);
        }
        blocklockIdToRequestContext.set(blocklockRequestId, requestContext);
        console.log(`[Timelock Service] Mapped Blocklock ID ${blocklockRequestId} to Context ${requestContext}`);


        return {
            requestId: blocklockRequestId,
            txHash: txResponse.hash,
            ciphertextHash: ciphertextHash
        };

    } catch (error: any) {
        console.error(`[Timelock Service Error Context: ${requestContext}] Error during commit:`, error.message);
        if (txResponse?.hash) console.error(`[Timelock Service] Failing Transaction Hash: ${txResponse.hash}`);
        // Log failure to Recall under the given context
        await logRecallEvent('TIMELOCK_COMMIT_FAILURE', { error: error.message, txHash: txResponse?.hash, requestContext }, requestContext);
        return null;
    }
}

// --- Reveal Listener Logic ---
const handleRevealEvent = async (
    requestIdBigInt: bigint,
    requester: string,
    revealedVerdictBytes: string,
    eventLog: EventLog // Use ethers v6 EventLog type
) => {
    const blocklockRequestId = requestIdBigInt.toString();
    const txHash = eventLog.transactionHash;
    const blockNumber = eventLog.blockNumber;

    console.log(`\n[Timelock Listener] === Received VerdictRevealed event ===`);
    console.log(`  Block Number: ${blockNumber}`);
    console.log(`  Blocklock Request ID: ${blocklockRequestId}`);
    console.log(`  Revealed By Tx: ${txHash}`);
    console.log(`  Original Requester: ${requester}`); // Address that called commitVerdict

     // Find the original Kintask request context using the map
     const requestContext = blocklockIdToRequestContext.get(blocklockRequestId);
     if (!requestContext) {
         console.warn(`[Timelock Listener] Could not find request context for revealed Blocklock ID: ${blocklockRequestId}. Cannot log details to Recall.`);
         // We don't know the context, so we can't log under it. Consider a global error log?
         // Clean up map entry if it somehow exists but value is bad? (unlikely)
         blocklockIdToRequestContext.delete(blocklockRequestId);
         return; // Stop processing if context unknown
     }
     console.log(`  Associated Request Context: ${requestContext}`);

     try {
        // Decode the revealed verdict bytes (assuming it was encoded as string)
        const encoder = AbiCoder.defaultAbiCoder();
        const [revealedVerdict] = encoder.decode(['string'], revealedVerdictBytes);
        // const revealedVerdict = ethers.toUtf8String(revealedVerdictBytes); // If using simple encoding

        console.log(`[Timelock Listener] Decoded Verdict for context ${requestContext}: "${revealedVerdict}"`);

        // Log this reveal to Recall Service under the original request context
        await logRecallEvent(
            'TIMELOCK_REVEAL_RECEIVED',
            {
                blocklockRequestId,
                revealedVerdict,
                sourceTxHash: txHash,
                blockNumber,
                requester // Original committer address
             },
            requestContext // Log under the original context
        );
        console.log(`[Timelock Listener] Logged TIMELOCK_REVEAL_RECEIVED to Recall for context ${requestContext}`);

        // Optional: Trigger follow-up actions based on revealed verdict
        // e.g., compare revealed verdict with final state, update database, etc.

        // Clean up the mapping AFTER successful processing and logging
        blocklockIdToRequestContext.delete(blocklockRequestId);
        console.log(`[Timelock Listener] Processed and removed mapping for Blocklock ID ${blocklockRequestId}`);

     } catch(decodeError: any) {
        console.error(`[Timelock Listener] Error decoding or logging revealed verdict for ID ${blocklockRequestId}, Context ${requestContext}:`, decodeError.message);
        // Log error to recall, including raw bytes if helpful
        await logRecallEvent(
            'VERIFICATION_ERROR', // Use a generic error type
            {
                stage: 'TimelockRevealDecodeOrLog',
                error: decodeError.message,
                blocklockRequestId,
                rawBytes: revealedVerdictBytes,
                sourceTxHash: txHash
             },
            requestContext
        );
        // Clean up mapping even on decode/log error to prevent memory leaks
        blocklockIdToRequestContext.delete(blocklockRequestId);
     }
 };


// --- Listener Start/Stop ---
export function startRevealListener() {
    if (revealListenerAttached || !isTimelockInitialized || !commitmentContract) {
        if (revealListenerAttached) console.log("[Timelock Service] Reveal listener already attached.");
        else console.error("[Timelock Service] Cannot start listener, service not initialized properly.");
        return;
    }

    console.log("[Timelock Service] Attaching listener for VerdictRevealed events...");
    try {
        // Define filter using the contract instance
        const eventFilter = commitmentContract.filters.VerdictRevealed();

        // Store the listener function to remove it later
        currentListener = (reqId, reqAddr, verdictData, log) => {
            // Wrap the async handler to catch top-level errors in the handler itself
            handleRevealEvent(reqId, reqAddr, verdictData, log).catch(handlerError => {
                console.error("[Timelock Listener] Uncaught error within handleRevealEvent:", handlerError);
                // Log critical listener error? Difficult without context here.
            });
        };

        commitmentContract.on(eventFilter, currentListener);

        revealListenerAttached = true;
        console.log("[Timelock Service] Listener attached successfully.");

    } catch (error: any) {
        console.error("[Timelock Service] Failed to attach listener:", error.message);
        revealListenerAttached = false;
        currentListener = null;
    }
}

export function stopRevealListener() {
     if (revealListenerAttached && commitmentContract && currentListener) {
         console.log("[Timelock Service] Removing VerdictRevealed listener...");
         try {
             commitmentContract.off("VerdictRevealed", currentListener);
             revealListenerAttached = false;
             currentListener = null;
             console.log("[Timelock Service] Listener removed.");
         } catch (error: any) {
             console.error("[Timelock Service] Error removing listener:", error.message);
             // State might be inconsistent here
         }
     } else {
          console.log("[Timelock Service] Listener not running or contract instance not available.");
     }
     // Clear the context map on shutdown? Maybe not, allow processing of pending reveals if restarted quickly?
     // blocklockIdToRequestContext.clear();
}
