// ./src/services/timelockService.ts
import { ethers, Wallet, Contract, utils, providers, BigNumber, Event } from 'ethers'; // Use v5 imports
import { Blocklock, SolidityEncoder, encodeCiphertextToSolidity, TypesLib } from 'blocklock-js';
import config from '../config';
// @ts-ignore - Assume JSON ABI is correct
import KintaskCommitmentAbi from '../contracts/abi/KintaskCommitment.json';
import { KINTASK_COMMITMENT_CONTRACT_ADDRESS } from '../contracts/addresses';
import { logRecallEvent } from './recallService'; // Import recall logger for reveal events

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
        if (!config.l2RpcUrl || !config.walletPrivateKey || !config.blocklockSenderProxyAddress || !KINTASK_COMMITMENT_CONTRACT_ADDRESS) {
             console.warn("[Timelock Service] Skipping initialization: Missing required config.");
             return false;
         }
          // @ts-ignore
          if (!KintaskCommitmentAbi.abi || KintaskCommitmentAbi.abi.length === 0) {
               console.error("[Timelock Service] FATAL ERROR: KintaskCommitment ABI missing.");
               return false;
          }

        provider = new providers.StaticJsonRpcProvider(config.l2RpcUrl);
        wallet = new Wallet(config.walletPrivateKey, provider);

        import('blocklock-js').then(BlocklockModule => {
            blocklockJsInstance = new BlocklockModule.Blocklock(wallet!, config.blocklockSenderProxyAddress!);
             // @ts-ignore
             commitmentContract = new Contract(KINTASK_COMMITMENT_CONTRACT_ADDRESS!, KintaskCommitmentAbi.abi, wallet);

             Promise.all([
                 provider!.getNetwork(),
                 // --- FIX: Use contract.address property (ethers v5) ---
                 Promise.resolve(commitmentContract.address) // Resolve address property
                 // --- END FIX ---
             ]).then(async ([network, address]) => { // Mark async to await getBlockNumber
                 console.log(`[Timelock Service] Connected to network: ${network.name} (Chain ID: ${network.chainId})`);
                 console.log(`[Timelock Service] Contract instance connected at: ${address}`); // address is now directly the string
                 try {
                    // Initialize lastPolledBlock - this part remains the same
                    // @ts-ignore TODO: Remove polling or fix getBlockNumber call if needed
                    // lastPolledBlock = await provider!.getBlockNumber();
                    // console.log(`[Timelock Service] Initial polling block set to: ${lastPolledBlock}`);
                    isTimelockInitialized = true;
                    console.log("[Timelock Service] Initialization complete.");
                    startRevealListener(); // Start listener
                } catch (blockNumError: any) {
                    console.error("[Timelock Service] Failed to get initial block number:", blockNumError.message);
                    isTimelockInitialized = false;
                }
             }).catch(err => {
                 console.error("[Timelock Service] Post-init check failed:", err.message);
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
        console.log(`[Timelock Service Context: ${logContext}] Current Block: ${currentBlockNumber}, Decryption Block Target: ${decryptionBlockNumber.toString()}`);

        const encoder = utils.defaultAbiCoder;
        const encodedVerdict = encoder.encode(['string'], [verdict]);
        const encodedVerdictBytes = utils.arrayify(encodedVerdict);

        console.log(`[Timelock Service Context: ${logContext}] Encrypting verdict "${verdict}"`);
        const ciphertext: TypesLib.Ciphertext = blocklockJsInstance.encrypt(encodedVerdictBytes, BigInt(currentBlockNumber + delayInBlocks));

        const { encodeCiphertextToSolidity } = await import('blocklock-js');
        const solidityCiphertext = encodeCiphertextToSolidity(ciphertext);
        const ciphertextHash = utils.keccak256(solidityCiphertext.v);
        console.log(`[Timelock Service Context: ${logContext}] Ciphertext Hash: ${ciphertextHash}`);

        // --- FIX: Use contract.address property (ethers v5) ---
        const contractAddress = commitmentContract.address;
        console.log(`[Timelock Service Context: ${logContext}] Sending commitVerdict transaction to ${contractAddress}...`);
        // --- END FIX ---

        // Optional Gas Estimation (v5 uses estimateGas property on the function)
        let estimatedGas: BigNumber | undefined;
        try {
            estimatedGas = await commitmentContract.estimateGas.commitVerdict(
                 decryptionBlockNumber,
                 solidityCiphertext
            );
            console.log(`[Timelock Service DEBUG] Estimated Gas: ${estimatedGas.toString()}`);
        } catch (simError: any) {
            let reason = simError.reason || simError.message;
             // v5 error data might be different, simpler check
             if (simError.error?.data?.message) { reason = simError.error.data.message; }
            console.error(`[Timelock Service DEBUG] Gas estimation/simulation FAILED: ${reason}`);
            throw new Error(`Transaction simulation/estimation failed: ${reason}`);
        }

        txResponse = await commitmentContract.commitVerdict(
            decryptionBlockNumber,
            solidityCiphertext,
            // Apply gas limit bump if estimation worked
            { gasLimit: estimatedGas ? estimatedGas.mul(120).div(100) : undefined }
        );

        if (!txResponse) {
            throw new Error("commitVerdict call returned null response.");
        }

        console.log(`[Timelock Service Context: ${logContext}] Commit transaction sent. Hash: ${txResponse.hash}`);
        console.log(`[Timelock Service Context: ${logContext}] Waiting for confirmation (1 block)...`);
        const receipt: providers.TransactionReceipt | null = await txResponse.wait(1);

        if (!receipt) {
             throw new Error(`Commit transaction ${txResponse?.hash ?? 'unknown'} confirmation timed out or receipt was null.`);
         }

        console.log(`[Timelock Service Context: ${logContext}] Commit Tx Confirmed. Status: ${receipt.status}, Block: ${receipt.blockNumber}`);
        if (receipt.status !== 1) {
            throw new Error(`Commit transaction ${txResponse?.hash ?? 'unknown'} failed on-chain (Status: 0). Check explorer.`);
        }

        const eventInterface = commitmentContract.interface;
        const eventSignature = 'VerdictCommitted(uint256,address,uint256,bytes32)';
        const eventTopic = eventInterface.getEventTopic(eventSignature);
        const receiptLogs = receipt.logs || [];
        const log = receiptLogs.find((l) =>
            l.topics[0] === eventTopic &&
            l.address.toLowerCase() === KINTASK_COMMITMENT_CONTRACT_ADDRESS!.toLowerCase()
        );

        if (!log) {
            throw new Error(`Could not find VerdictCommitted event log in transaction receipt for ${txResponse?.hash ?? 'unknown'}.`);
        }
        const decodedLog = eventInterface.parseLog(log);
        const blocklockRequestId = decodedLog?.args.blocklockRequestId?.toString();
        if (!blocklockRequestId) throw new Error('Failed to decode Blocklock Request ID from VerdictCommitted event.');
        console.log(`[Timelock Service Context: ${logContext}] Successfully committed. Blocklock Request ID: ${blocklockRequestId}`);

        if (requestContext) {
            if (blocklockIdToRequestContext.size >= MAX_CONTEXT_MAP_SIZE) {
                const oldestKey = blocklockIdToRequestContext.keys().next().value;
                if (oldestKey !== undefined) {
                    blocklockIdToRequestContext.delete(oldestKey);
                    console.warn(`[Timelock Service] Context map size limit reached, removed oldest entry: ${oldestKey}`);
                }
            }
            blocklockIdToRequestContext.set(blocklockRequestId, requestContext);
            console.log(`[Timelock Service] Mapped Blocklock ID ${blocklockRequestId} to Context ${requestContext}`);
        } else { console.warn("[Timelock Service] Request context not provided for mapping reveal listener."); }

        return {
            requestId: blocklockRequestId,
            txHash: txResponse?.hash ?? 'unknown_hash',
            ciphertextHash: ciphertextHash
        };

    } catch (error: any) {
        console.error(`[Timelock Service Error Context: ${logContext}] Error during commit:`, error.message);
        if (txResponse?.hash) console.error(`[Timelock Service] Failing Transaction Hash: ${txResponse.hash}`);
        return null;
    }
}

// --- Reveal Listener ---
export function startRevealListener() {
    if (revealListenerAttached) { return; }
     if (!isTimelockInitialized || !commitmentContract) {
         console.warn("[Timelock Service] Cannot start listener, service not fully initialized yet.");
         return;
     }

    console.log(`[Timelock Service] Attaching listener for VerdictRevealed events on contract ${KINTASK_COMMITMENT_CONTRACT_ADDRESS}...`);
    try {
        const eventFilter = commitmentContract.filters.VerdictRevealed();

         commitmentContract.on(eventFilter, async (requestIdBigNumber, requester, revealedVerdictBytes, event: Event) => {
            const blocklockRequestId = requestIdBigNumber.toString();
            const txHash = event.transactionHash;

            console.log(`\n[Timelock Listener] === Received VerdictRevealed Event ===`);
            console.log(`  Blocklock Request ID: ${blocklockRequestId}`);
            console.log(`  Event Source Tx Hash: ${txHash}`);

             const requestContext = blocklockIdToRequestContext.get(blocklockRequestId);
             if (!requestContext) {
                 console.warn(`[Timelock Listener] Could not find request context for revealed Blocklock ID: ${blocklockRequestId}.`);
                 return;
             }
             console.log(`  Associated Request Context: ${requestContext}`);
             blocklockIdToRequestContext.delete(blocklockRequestId);

             try {
                const encoder = utils.defaultAbiCoder;
                const [revealedVerdict] = encoder.decode(['string'], revealedVerdictBytes);
                console.log(`[Timelock Listener] Decoded Verdict for context ${requestContext}: "${revealedVerdict}"`);

                await logRecallEvent(
                    'TIMELOCK_REVEAL_RECEIVED',
                    { blocklockRequestId, revealedVerdict, sourceTxHash: txHash, requester },
                    requestContext
                );
                console.log(`[Timelock Listener] Logged TIMELOCK_REVEAL_RECEIVED to Recall for context ${requestContext}`);
             } catch(decodeError: any) {
                console.error(`[Timelock Listener] Error decoding revealed verdict for ID ${blocklockRequestId}, Context ${requestContext}:`, decodeError.message);
                 await logRecallEvent(
                    'VERIFICATION_ERROR',
                    { stage: 'TimelockRevealDecode', error: decodeError.message, blocklockRequestId, rawBytes: utils.hexlify(revealedVerdictBytes) },
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

// Function to stop listener
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
     }
}