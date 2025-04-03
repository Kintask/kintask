import { ethers, Wallet, Contract, AbiCoder, keccak256, getBytes, TransactionResponse, TransactionReceipt, Log, EventLog } from 'ethers';
import { Blocklock, SolidityEncoder, encodeCiphertextToSolidity, TypesLib } from 'blocklock-js';
import config from '../config';
import KintaskCommitmentAbi from '../contracts/abi/KintaskCommitment.json'; // Load the ABI
import { KINTASK_COMMITMENT_CONTRACT_ADDRESS } from '../contracts/addresses';
import { logRecallEvent } from './recallService'; // Import recall logger for reveal events

interface CommitResult {
    requestId: string; // The on-chain request ID from Blocklock
    txHash: string; // The L2 transaction hash
    ciphertextHash: string; // Hash of the encrypted data 'v' field
}

// --- Initialization ---
let provider: ethers.JsonRpcProvider | null = null;
let wallet: Wallet | null = null;
let blocklockJsInstance: Blocklock | null = null;
let commitmentContract: Contract | null = null;
let isTimelockInitialized = false;
let revealListenerAttached = false;
// Simple mapping to associate blocklock request ID with our internal request context for logging reveals
const blocklockIdToRequestContext = new Map<string, string>();
const MAX_CONTEXT_MAP_SIZE = 1000; // Prevent memory leak

// Function to initialize (or re-initialize) the service
// Returns true if initialization is complete or already done, false if required config is missing
function initializeTimelockService(): boolean {
    if (isTimelockInitialized) return true; // Already initialized
    console.log("[Timelock Service] Initializing...");
    try {
        // Validate critical config FIRST
         if (!config.l2RpcUrl || !config.walletPrivateKey || !config.blocklockSenderProxyAddress || !KINTASK_COMMITMENT_CONTRACT_ADDRESS) {
             console.warn("[Timelock Service] Skipping initialization: Missing required L2/Blocklock/Contract configuration in .env");
             return false; // Cannot initialize
         }
         // Validate ABI presence
          if (!KintaskCommitmentAbi.abi || KintaskCommitmentAbi.abi.length === 0) {
               console.error("[Timelock Service] FATAL ERROR: KintaskCommitment ABI not found or empty. Run 'pnpm contracts:compile' and copy ABI.");
               return false; // Cannot initialize without ABI
          }

        provider = new ethers.JsonRpcProvider(config.l2RpcUrl);
        wallet = new Wallet(config.walletPrivateKey, provider);
        blocklockJsInstance = new Blocklock(wallet, config.blocklockSenderProxyAddress);
        commitmentContract = new Contract(KINTASK_COMMITMENT_CONTRACT_ADDRESS, KintaskCommitmentAbi.abi, wallet);

        // Perform async checks AFTER basic setup
         Promise.all([
             provider.getNetwork(),
             commitmentContract.getAddress() // Check if contract connection works
         ]).then(([network, address]) => {
             console.log(`[Timelock Service] Connected to network: ${network.name} (Chain ID: ${network.chainId})`);
             console.log(`[Timelock Service] KintaskCommitment contract instance connected at: ${address}`);
             isTimelockInitialized = true; // Mark as fully initialized only after checks pass
             console.log("[Timelock Service] Initialization complete.");
             // Attempt to start listener only after successful init
              startRevealListener(); // Start listener now that we are initialized
         }).catch(err => {
             console.error("[Timelock Service] Post-initialization check failed (Network or Contract connection issue):", err.message);
             // Keep isTimelockInitialized = false if checks fail
             isTimelockInitialized = false;
         });

         console.log("[Timelock Service] Initialization sequence started (async checks pending)...");
         return true; // Return true indicating initialization started

    } catch (error: any) {
         console.error("[Timelock Service] FATAL Initialization failed:", error.message);
         isTimelockInitialized = false;
         return false; // Indicate failure
    }
}

// Attempt initialization on module load
initializeTimelockService();

// --- Commit Function ---
export async function commitVerdictTimelocked(
    verdict: string,
    delayInBlocks: number = 5, // Default delay
    requestContext?: string // Pass context for mapping reveal logs
): Promise<CommitResult | null> {

    // Check initialization status before proceeding
    if (!isTimelockInitialized || !blocklockJsInstance || !commitmentContract || !provider || !wallet) {
        console.error('[Timelock Service] Service not initialized or ready. Cannot commit verdict.');
        return null; // Fail if not ready
    }

    let txResponse: TransactionResponse | null = null; // Define txResponse outside try
    const logContext = requestContext || 'unknownContext'; // Use provided context or a default

    try {
        const currentBlockNumber = await provider.getBlockNumber();
        const decryptionBlockNumber = BigInt(currentBlockNumber + delayInBlocks);
        console.log(`[Timelock Service Context: ${logContext}] Current Block: ${currentBlockNumber}, Decryption Block Target: ${decryptionBlockNumber}`);

        // 1. Encode verdict string
        const encoder = AbiCoder.defaultAbiCoder();
        const encodedVerdict = encoder.encode(['string'], [verdict]);
        const encodedVerdictBytes = getBytes(encodedVerdict);

        // 2. Encrypt using blocklock-js
        console.log(`[Timelock Service Context: ${logContext}] Encrypting verdict "${verdict}"`);
        const ciphertext: TypesLib.Ciphertext = blocklockJsInstance.encrypt(encodedVerdictBytes, decryptionBlockNumber);
        const solidityCiphertext = encodeCiphertextToSolidity(ciphertext);
        const ciphertextHash = keccak256(solidityCiphertext.v); // Hash the encrypted part V
        console.log(`[Timelock Service Context: ${logContext}] Ciphertext Hash: ${ciphertextHash}`);

        // 3. Call commitVerdict on contract
        console.log(`[Timelock Service Context: ${logContext}] Sending commitVerdict transaction to ${await commitmentContract.getAddress()}...`);
        txResponse = await commitmentContract.commitVerdict(
            decryptionBlockNumber,
            solidityCiphertext
            // Optional: Add gas estimation/limit
            // { gasLimit: 300000 } // Example fixed gas limit
        );
        console.log(`[Timelock Service Context: ${logContext}] Commit transaction sent. Hash: ${txResponse.hash}`);
        console.log(`[Timelock Service Context: ${logContext}] Waiting for confirmation (1 block)...`);
        const receipt: TransactionReceipt | null = await txResponse.wait(1);

        if (!receipt) throw new Error(`Commit transaction ${txResponse.hash} confirmation timed out or receipt was null.`);
        console.log(`[Timelock Service Context: ${logContext}] Commit Tx Confirmed. Status: ${receipt.status}, Block: ${receipt.blockNumber}`);
        if (receipt.status !== 1) throw new Error(`Commit transaction ${txResponse.hash} failed on-chain (Status: 0). Check explorer.`);

        // 4. Parse Blocklock Request ID from logs emitted by *our* contract
        const eventInterface = commitmentContract.interface.getEvent('VerdictCommitted');
        const eventTopic = eventInterface.topicHash;
        const receiptLogs = receipt.logs || []; // Ensure logs is an array
        const log = receiptLogs.find((l: Log) =>
            l.topics[0] === eventTopic &&
            l.address.toLowerCase() === KINTASK_COMMITMENT_CONTRACT_ADDRESS.toLowerCase()
        );

        if (!log) throw new Error(`Could not find VerdictCommitted event log in transaction receipt for ${txResponse.hash}.`);

        const decodedLog = commitmentContract.interface.parseLog({ topics: [...log.topics], data: log.data });
        const blocklockRequestId = decodedLog?.args.blocklockRequestId?.toString();
        if (!blocklockRequestId) throw new Error('Failed to decode Blocklock Request ID from VerdictCommitted event.');

        console.log(`[Timelock Service Context: ${logContext}] Successfully committed. Blocklock Request ID: ${blocklockRequestId}`);

        // Store mapping for the listener
        if (requestContext) {
            if (blocklockIdToRequestContext.size >= MAX_CONTEXT_MAP_SIZE) {
                const oldestKey = blocklockIdToRequestContext.keys().next().value;
                 blocklockIdToRequestContext.delete(oldestKey);
                 console.warn(`[Timelock Service] Context map size limit reached, removed oldest entry: ${oldestKey}`);
            }
            blocklockIdToRequestContext.set(blocklockRequestId, requestContext);
            console.log(`[Timelock Service] Mapped Blocklock ID ${blocklockRequestId} to Context ${requestContext}`);
        } else {
             console.warn("[Timelock Service] Request context not provided for mapping reveal listener.");
        }

        return {
            requestId: blocklockRequestId,
            txHash: txResponse.hash,
            ciphertextHash: ciphertextHash
        };

    } catch (error: any) {
        console.error(`[Timelock Service Error Context: ${logContext}] Error during commit:`, error.message);
        if (txResponse?.hash) console.error(`[Timelock Service] Failing Transaction Hash: ${txResponse.hash}`);
        return null; // Indicate failure
    }
}

// --- Reveal Listener ---
export function startRevealListener() {
    if (revealListenerAttached) {
        // console.log("[Timelock Service] Reveal listener already attached.");
        return;
    }
     // Ensure initialized before attaching listener
     if (!isTimelockInitialized || !commitmentContract) {
         console.warn("[Timelock Service] Cannot start listener, service not fully initialized yet.");
         // Initialization might still be in async checks, listener will start when/if init completes.
         return;
     }

    console.log(`[Timelock Service] Attaching listener for VerdictRevealed events on contract ${KINTASK_COMMITMENT_CONTRACT_ADDRESS}...`);
    try {
        const eventFilter = commitmentContract.filters.VerdictRevealed();

         // Using commitmentContract.on() sets up a persistent listener
         commitmentContract.on(eventFilter, async (requestIdBigInt, requester, revealedVerdictBytes, eventLog) => {
            // Type assertion for ethers v6 EventLog
            const log = eventLog as unknown as EventLog;
            const blocklockRequestId = requestIdBigInt.toString();
            const txHash = log.transactionHash; // Tx hash where the Blocklock callback happened

            console.log(`\n[Timelock Listener] === Received VerdictRevealed Event ===`);
            console.log(`  Blocklock Request ID: ${blocklockRequestId}`);
            console.log(`  Event Source Tx Hash: ${txHash}`); // This is the Blocklock callback tx hash

             // Find the original request context using the mapping
             const requestContext = blocklockIdToRequestContext.get(blocklockRequestId);
             if (!requestContext) {
                 console.warn(`[Timelock Listener] Could not find request context for revealed Blocklock ID: ${blocklockRequestId}. Cannot log details to Recall.`);
                 // It's possible the context map was cleared or this ID was processed already
                 return;
             }
             console.log(`  Associated Request Context: ${requestContext}`);

             // Clean up the mapping immediately to prevent reprocessing
             blocklockIdToRequestContext.delete(blocklockRequestId);

             try {
                // Decode the revealed verdict bytes (assuming it was encoded as a string)
                const encoder = AbiCoder.defaultAbiCoder();
                const [revealedVerdict] = encoder.decode(['string'], revealedVerdictBytes);

                console.log(`[Timelock Listener] Decoded Verdict for context ${requestContext}: "${revealedVerdict}"`);

                // Log this reveal event to Recall Service under the original request context
                await logRecallEvent(
                    'TIMELOCK_REVEAL_RECEIVED',
                    { blocklockRequestId, revealedVerdict, sourceTxHash: txHash, requester },
                    requestContext
                );
                console.log(`[Timelock Listener] Logged TIMELOCK_REVEAL_RECEIVED to Recall for context ${requestContext}`);

                // TODO: Compare revealedVerdict with final calculated verdict from verifierService state?

             } catch(decodeError: any) {
                console.error(`[Timelock Listener] Error decoding revealed verdict for ID ${blocklockRequestId}, Context ${requestContext}:`, decodeError.message);
                // Log decode error to recall
                 await logRecallEvent(
                    'VERIFICATION_ERROR',
                    { stage: 'TimelockRevealDecode', error: decodeError.message, blocklockRequestId, rawBytes: ethers.hexlify(revealedVerdictBytes) },
                    requestContext
                );
             }
         });

        revealListenerAttached = true;
        console.log("[Timelock Service] Listener attached successfully.");

    } catch (error: any) {
        console.error("[Timelock Service] Failed to attach listener:", error.message);
        revealListenerAttached = false;
    }
}

// Function to stop listener (e.g., on shutdown)
export function stopRevealListener() {
     if (revealListenerAttached && commitmentContract) {
         console.log("[Timelock Service] Removing VerdictRevealed listener...");
         try {
             // Use off() or removeAllListeners() depending on specific needs and ethers version guarantees
             commitmentContract.off("VerdictRevealed"); // Attempt to remove specific listener type
             // Alternatively: commitmentContract.removeAllListeners("VerdictRevealed");
             revealListenerAttached = false;
             console.log("[Timelock Service] Listener removed.");
         } catch (error: any) {
             console.error("[Timelock Service] Error removing listener:", error.message);
             revealListenerAttached = false;
         }
     } else {
          // console.log("[Timelock Service] Listener not attached or contract not initialized.");
     }
}
