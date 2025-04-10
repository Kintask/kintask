// ./src/services/timelockService.ts
import { ethers, Wallet, Contract, utils, providers, BigNumber, Event } from 'ethers'; // Use v5 imports
import { Blocklock, SolidityEncoder, encodeCiphertextToSolidity, TypesLib } from 'blocklock-js';
import config from '../config';
// @ts-ignore - Assume JSON ABI is correct
import KintaskCommitmentAbi from '../contracts/abi/KintaskCommitment.json';
import { KINTASK_COMMITMENT_CONTRACT_ADDRESS } from '../contracts/addresses';
// Import necessary functions from recallService
import { addObjectToBucket } from './recallService';
// Import truncateText utility
import { truncateText } from '../utils'; // Added import

interface CommitResult {
    requestId: string;
    txHash: string;
    ciphertextHash: string;
}

// --- Initialization ---
let provider: providers.StaticJsonRpcProvider | null = null;
let wallet: Wallet | null = null;
let blocklockJsInstance: Blocklock | null = null;
let commitmentContract: Contract | null = null;
let isTimelockInitialized = false;
let revealListenerAttached = false;
const blocklockIdToRequestContext = new Map<string, string>();
const MAX_CONTEXT_MAP_SIZE = 1000;

// Function to initialize (or re-initialize) the service
function initializeTimelockService(): boolean {
    if (isTimelockInitialized) return true;
    console.log("[Timelock Service] Initializing...");
    try {
        const rpcUrl = config.l2RpcUrl;
        const privateKey = config.walletPrivateKey;
        const blocklockProxy = config.blocklockSenderProxyAddress;
        const kintaskAddress = KINTASK_COMMITMENT_CONTRACT_ADDRESS;

        if (!rpcUrl || !privateKey || !blocklockProxy || !kintaskAddress) {
             console.warn("[Timelock Service] Skipping initialization: Missing required L2/Blocklock config.");
             return false;
         }
          // @ts-ignore
          if (!KintaskCommitmentAbi.abi || KintaskCommitmentAbi.abi.length === 0) {
               console.error("[Timelock Service] FATAL ERROR: KintaskCommitment ABI missing.");
               return false;
          }

        provider = new providers.StaticJsonRpcProvider(rpcUrl);
        wallet = new Wallet(privateKey, provider);

        import('blocklock-js').then(BlocklockModule => {
            blocklockJsInstance = new BlocklockModule.Blocklock(wallet!, blocklockProxy);
             // @ts-ignore
             commitmentContract = new Contract(kintaskAddress, KintaskCommitmentAbi.abi, wallet);

             Promise.all([
                 provider!.getNetwork(),
                 Promise.resolve(commitmentContract!.address)
             ]).then(async ([network, address]) => {
                 console.log(`[Timelock Service] Connected to network: ${network.name} (Chain ID: ${network.chainId})`);
                 console.log(`[Timelock Service] KintaskCommitment contract instance connected at: ${address}`);
                 try {
                    isTimelockInitialized = true;
                    console.log("[Timelock Service] Initialization complete.");
                    startRevealListener();
                } catch (blockNumError: any) {
                    console.error("[Timelock Service] Error during post-init setup:", blockNumError.message);
                    isTimelockInitialized = false;
                }
             }).catch(err => {
                 console.error("[Timelock Service] Network/Contract connection check failed:", err.message);
                 isTimelockInitialized = false;
             });
        }).catch(importError => {
            console.error("[Timelock Service] FATAL: Failed to import blocklock-js:", importError);
            isTimelockInitialized = false;
        });

         console.log("[Timelock Service] Initialization sequence started...");
         return true;

    } catch (error: any) {
         console.error("[Timelock Service] FATAL Initialization failed:", error.message);
         isTimelockInitialized = false;
         return false;
    }
}

// Attempt initialization on module load
initializeTimelockService();

// --- Commit Function ---
export async function commitVerdictTimelocked(
    verdict: string,
    delayInBlocks: number = 5,
    requestContext?: string
): Promise<CommitResult | null> {

    if (!isTimelockInitialized || !blocklockJsInstance || !commitmentContract || !provider || !wallet) {
        console.error('[Timelock Service] Service not initialized or ready. Cannot commit verdict.');
        return null;
    }

    let txResponse: providers.TransactionResponse | null = null;
    const logContext = requestContext || 'unknownContext';

    try {
        const currentBlockNumber = await provider.getBlockNumber();
        const decryptionBlockNumber = BigNumber.from(currentBlockNumber + delayInBlocks);
        console.log(`[Timelock Service Context: ${logContext.substring(0,10)}] Current Block: ${currentBlockNumber}, Decryption Block Target: ${decryptionBlockNumber.toString()}`);

        const encoder = utils.defaultAbiCoder;
        const encodedVerdict = encoder.encode(['string'], [verdict]);
        const encodedVerdictBytes = utils.arrayify(encodedVerdict);

        // Use imported truncateText
        console.log(`[Timelock Service Context: ${logContext.substring(0,10)}] Encrypting verdict: "${truncateText(verdict, 50)}"`);
        const ciphertext: TypesLib.Ciphertext = blocklockJsInstance!.encrypt(encodedVerdictBytes, BigInt(decryptionBlockNumber.toString()));

        const { encodeCiphertextToSolidity } = await import('blocklock-js');
        const solidityCiphertext = encodeCiphertextToSolidity(ciphertext);
        const ciphertextHash = utils.keccak256(solidityCiphertext.v);
        console.log(`[Timelock Service Context: ${logContext.substring(0,10)}] Ciphertext Hash: ${ciphertextHash}`);

        const contractAddress = commitmentContract.address;
        console.log(`[Timelock Service Context: ${logContext.substring(0,10)}] Sending commitVerdict transaction to ${contractAddress}...`);

        let estimatedGas: BigNumber | undefined;
        try {
            estimatedGas = await commitmentContract.estimateGas.commitVerdict(
                 decryptionBlockNumber,
                 solidityCiphertext
            );
            console.log(`[Timelock Service DEBUG Context: ${logContext.substring(0,10)}] Estimated Gas: ${estimatedGas.toString()}`);
        } catch (simError: any) {
            let reason = simError.reason || simError.error?.data?.message || simError.data?.message || simError.message;
            console.error(`[Timelock Service DEBUG Context: ${logContext.substring(0,10)}] Gas estimation/simulation FAILED: ${reason}`);
            if (reason?.toLowerCase().includes('revert')) {
               throw new Error(`Transaction simulation reverted: ${reason}`);
            }
            console.warn(`[Timelock Service Context: ${logContext.substring(0,10)}] Proceeding without gas estimate due to simulation error.`);
            estimatedGas = undefined;
        }

        txResponse = await commitmentContract.commitVerdict(
            decryptionBlockNumber,
            solidityCiphertext,
            { gasLimit: estimatedGas ? estimatedGas.mul(120).div(100) : undefined }
        );

        if (!txResponse) { throw new Error("commitVerdict call returned null response."); }

        console.log(`[Timelock Service Context: ${logContext.substring(0,10)}] Commit transaction sent. Hash: ${txResponse.hash}`);
        console.log(`[Timelock Service Context: ${logContext.substring(0,10)}] Waiting for confirmation (1 block)...`);
        const receipt: providers.TransactionReceipt | null = await txResponse.wait(1);

        if (!receipt) { throw new Error(`Commit transaction ${txResponse?.hash ?? 'unknown'} confirmation timed out or receipt was null.`); }

        console.log(`[Timelock Service Context: ${logContext.substring(0,10)}] Commit Tx Confirmed. Status: ${receipt.status === 1 ? 'Success' : 'Failed'}, Block: ${receipt.blockNumber}`);
        if (receipt.status !== 1) {
            // await logErrorEvent({ stage: 'TimelockCommitTxFailed', txHash: txResponse.hash, blockNumber: receipt.blockNumber, reason: 'On-chain status 0' }, logContext);
            throw new Error(`Commit transaction ${txResponse?.hash ?? 'unknown'} failed on-chain (Status: 0). Check explorer.`);
        }

        const eventInterface = commitmentContract.interface;
        const eventSignature = 'VerdictCommitted(uint256,address,uint256,bytes32)';
        const eventTopic = eventInterface.getEventTopic(eventSignature);
        const receiptLogs = receipt.logs || [];
        const contractAddressLower = KINTASK_COMMITMENT_CONTRACT_ADDRESS!.toLowerCase();

        const log = receiptLogs.find((l) =>
            l.address.toLowerCase() === contractAddressLower &&
            l.topics[0] === eventTopic
        );

        if (!log) {
            console.error(`[Timelock Service Context: ${logContext.substring(0,10)}] Could not find VerdictCommitted event log in tx ${txResponse?.hash ?? 'unknown'}. Logs found:`, receiptLogs.map(l=>({addr: l.address, topics: l.topics})));
            throw new Error(`Could not find VerdictCommitted event log in transaction receipt for ${txResponse?.hash ?? 'unknown'}.`);
        }
        const decodedLog = eventInterface.parseLog(log);
        const blocklockRequestId = decodedLog?.args.blocklockRequestId?.toString();
        if (!blocklockRequestId) throw new Error('Failed to decode Blocklock Request ID from VerdictCommitted event.');
        console.log(`[Timelock Service Context: ${logContext.substring(0,10)}] Successfully committed. Blocklock Request ID: ${blocklockRequestId}`);

        if (requestContext) {
            if (blocklockIdToRequestContext.size >= MAX_CONTEXT_MAP_SIZE) {
                const oldestKey = blocklockIdToRequestContext.keys().next().value;
                if (oldestKey !== undefined) {
                    blocklockIdToRequestContext.delete(oldestKey);
                    console.warn(`[Timelock Service] Context map size limit reached, removed oldest entry: ${oldestKey}`);
                }
            }
            blocklockIdToRequestContext.set(blocklockRequestId, requestContext);
            console.log(`[Timelock Service] Mapped Blocklock ID ${blocklockRequestId} to Context ${requestContext.substring(0,10)}...`);
        } else {
            console.warn("[Timelock Service] Request context not provided for mapping reveal listener.");
        }

        return {
            requestId: blocklockRequestId,
            txHash: txResponse?.hash ?? 'unknown_hash',
            ciphertextHash: ciphertextHash
        };

    } catch (error: any) {
        console.error(`[Timelock Service Error Context: ${logContext.substring(0,10)}] Error during commit:`, error.message || error);
        if (txResponse?.hash) console.error(`[Timelock Service] Failing Transaction Hash: ${txResponse.hash}`);
        // await logErrorEvent({ stage: 'TimelockCommitCatch', error: error.message, txHash: txResponse?.hash }, logContext);
        return null;
    }
}

// --- Reveal Listener ---
export function startRevealListener() {
    if (revealListenerAttached) {
        console.log("[Timelock Service] Listener already attached.");
        return;
    }
     if (!isTimelockInitialized || !commitmentContract) {
         console.warn("[Timelock Service] Cannot start listener, service not fully initialized yet.");
         return;
     }

    console.log(`[Timelock Service] Attaching listener for VerdictRevealed events on contract ${KINTASK_COMMITMENT_CONTRACT_ADDRESS}...`);
    try {
        const eventFilter = commitmentContract.filters.VerdictRevealed();

         commitmentContract.on(eventFilter, async (requestIdBigNumber: BigNumber, requester: string, revealedVerdictBytes: ethers.BytesLike, event: Event) => {
            const blocklockRequestId = requestIdBigNumber.toString();
            const txHash = event.transactionHash;

            console.log(`\n[Timelock Listener] === Received VerdictRevealed Event ===`);
            console.log(`  Blocklock Request ID: ${blocklockRequestId}`);
            console.log(`  Event Source Tx Hash: ${txHash}`);

             const requestContext = blocklockIdToRequestContext.get(blocklockRequestId);
             if (!requestContext) {
                 console.warn(`[Timelock Listener] Could not find request context for revealed Blocklock ID: ${blocklockRequestId}. Ignoring event or logging generically.`);
                //  await logErrorEvent({ stage: 'TimelockRevealNoContext', blocklockRequestId, sourceTxHash: txHash }, `unknownContext_${blocklockRequestId}`);
                 return;
             }
             console.log(`  Associated Request Context: ${requestContext.substring(0,10)}...`);
             blocklockIdToRequestContext.delete(blocklockRequestId);

             try {
                const encoder = utils.defaultAbiCoder;
                const [revealedVerdict] = encoder.decode(['string'], revealedVerdictBytes);
                // Use imported truncateText
                console.log(`[Timelock Listener] Decoded Verdict for context ${requestContext.substring(0,10)}: "${truncateText(revealedVerdict, 50)}"`);

                // Log the reveal event to Recall
                // Ensure TIMELOCK_REVEALS_PREFIX is defined in recallService or here
                const timelockRevealKey = `timelock_reveals/${requestContext}/${blocklockRequestId}.json`; // Example prefix
                await addObjectToBucket(
                    { type: 'TIMELOCK_REVEAL_RECEIVED', blocklockRequestId, revealedVerdict, sourceTxHash: txHash, requester, timestamp: new Date().toISOString() },
                    timelockRevealKey
                );
                console.log(`[Timelock Listener] Logged TIMELOCK_REVEAL_RECEIVED to Recall for context ${requestContext.substring(0,10)}`);

             } catch(decodeError: any) {
                console.error(`[Timelock Listener] Error decoding revealed verdict for ID ${blocklockRequestId}, Context ${requestContext}:`, decodeError.message);
                //  await logErrorEvent(
                //     { stage: 'TimelockRevealDecode', error: decodeError.message, blocklockRequestId, rawBytes: utils.hexlify(revealedVerdictBytes) },
                //     requestContext
                // );
             }
         });

        revealListenerAttached = true;
        console.log("[Timelock Service] Listener attached successfully.");

    } catch (error: any) {
        console.error("[Timelock Service] Failed to attach listener:", error.message);
        revealListenerAttached = false;
    }
}

// --- Stop Listener ---
export function stopRevealListener() {
     if (revealListenerAttached && commitmentContract) {
         console.log("[Timelock Service] Removing VerdictRevealed listener...");
         try {
             commitmentContract.removeAllListeners("VerdictRevealed");
             revealListenerAttached = false;
             console.log("[Timelock Service] Listener removed.");
         } catch (error: any) {
             console.error("[Timelock Service] Error removing listener:", error.message);
             revealListenerAttached = false;
         }
     } else {
         console.log("[Timelock Service] Listener not attached or service not initialized.");
     }
}

// ==== ./services/timelockService.ts ====