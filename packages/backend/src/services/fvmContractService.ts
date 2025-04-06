// services/fvmContractService.ts
import { ethers, Wallet, Contract, providers, BigNumber } from 'ethers'; // Use v5 imports
import config from '../config';
import AggregatorAbi from '../contracts/abi/Aggregator.json'; // ABI for the Aggregator
import { FVM_AGGREGATOR_CONTRACT_ADDRESS } from '../contracts/addresses';

// --- Module State ---
let provider: providers.StaticJsonRpcProvider | null = null;
let wallet: Wallet | null = null;
let aggregatorContract: Contract | null = null;
let isFvmServiceInitialized = false;

// Function to initialize FVM service components
function initializeFvmService(): boolean {
    if (isFvmServiceInitialized) return true;
    console.log("[FVM Contract Service] Initializing...");

    try {
        // Validate required config
        if (!config.fvmRpcUrl || !config.recallPrivateKey || !FVM_AGGREGATOR_CONTRACT_ADDRESS) {
             console.error("[FVM Contract Service] Missing required config: FVM_RPC_URL, RECALL_PRIVATE_KEY, or FVM_AGGREGATOR_CONTRACT_ADDRESS.");
             return false;
        }
        // @ts-ignore - ABI structure check
        if (!AggregatorAbi.abi || AggregatorAbi.abi.length === 0) {
             console.error("[FVM Contract Service] FATAL ERROR: Aggregator ABI is missing or empty.");
             return false;
        }

        // Setup provider and wallet (using recallPrivateKey for FVM interactions)
        provider = new providers.StaticJsonRpcProvider(config.fvmRpcUrl);
        const fvmWalletPrivateKey = config.recallPrivateKey; // Reuse recall key
        wallet = new Wallet(fvmWalletPrivateKey, provider);
        console.log(`[FVM Contract Service] Using Wallet: ${wallet.address} on RPC: ${config.fvmRpcUrl}`);

        // Create contract instance
        // @ts-ignore - ABI type
        aggregatorContract = new Contract(FVM_AGGREGATOR_CONTRACT_ADDRESS, AggregatorAbi.abi, wallet);
        console.log(`[FVM Contract Service] Aggregator contract instance created at: ${aggregatorContract.address}`);

        // Perform a quick check (e.g., get owner) to ensure connection
        aggregatorContract.owner().then((owner: string) => {
            console.log(`[FVM Contract Service] Successfully connected to Aggregator contract. Owner: ${owner}`);
            isFvmServiceInitialized = true;
            console.log("[FVM Contract Service] Initialization complete.");
        }).catch((err: any) => {
            console.error("[FVM Contract Service] Failed to connect to Aggregator contract:", err.message || err);
            isFvmServiceInitialized = false;
        });

        return true; // Initialization sequence started

    } catch (error: any) {
         console.error("[FVM Contract Service] FATAL Initialization failed:", error.message);
         isFvmServiceInitialized = false;
         return false;
    }
}

// Attempt initialization on module load
initializeFvmService();


// --- Contract Interaction Functions ---

/**
 * Submits a verification result from a verification agent to the Aggregator contract.
 * @param requestContext The unique identifier for the request being verified.
 * @param agentId The identifier of the verification agent.
 * @param verdict The verdict string (e.g., "Correct", "Incorrect").
 * @param confidence A number from 0.0 to 1.0 (will be scaled to uint8 0-255).
 * @param evidenceCid The CID of the evidence supporting the verdict (can be the original KB CID).
 * @returns The transaction hash if successful, otherwise null.
 */
export async function submitVerificationResult(
    requestContext: string,
    agentId: string,
    verdict: string,
    confidence: number,
    evidenceCid: string
): Promise<string | null> {
    if (!isFvmServiceInitialized || !aggregatorContract || !wallet) {
        console.error('[FVM Contract Service] Service not initialized. Cannot submit verification.');
        return null;
    }
    // Validate confidence range and convert to uint8 (0-255)
    const confidenceUint8 = Math.max(0, Math.min(255, Math.round(confidence * 255)));
    console.log(`[FVM Contract Service] Submitting verification | Context: ${requestContext.substring(0,10)}, Agent: ${agentId}, Verdict: ${verdict}, Confidence: ${confidenceUint8}/255, Evidence: ${evidenceCid.substring(0,10)}...`);

    try {
        // Optional Gas Estimation
        let estimatedGas: BigNumber | undefined;
        try {
            estimatedGas = await aggregatorContract.estimateGas.submitVerificationResult(
                requestContext,
                agentId,
                verdict,
                confidenceUint8,
                evidenceCid
            );
            console.log(`[FVM Contract Service DEBUG] Estimated Gas for submitVerificationResult: ${estimatedGas.toString()}`);
        } catch (simError: any) {
             // Extract reason - ethers v5 style might need refinement based on actual FVM error structure
             let reason = simError.reason || simError.error?.data?.message || simError.data?.message || simError.message;
             console.error(`[FVM Contract Service DEBUG] Gas estimation/simulation FAILED for submitVerificationResult: ${reason}`);
             // Decide whether to throw or proceed without estimate based on error type
             // If it's a revert, we should probably throw.
             if (reason?.toLowerCase().includes('revert')) {
                throw new Error(`Transaction simulation reverted: ${reason}`);
             }
             // Otherwise, maybe proceed without estimate but log warning
             console.warn(`[FVM Contract Service] Proceeding without gas estimate due to simulation error.`);
             estimatedGas = undefined; // Ensure it's undefined if estimation failed non-critically
        }

        const txOptions = { gasLimit: estimatedGas ? estimatedGas.mul(120).div(100) : undefined }; // Add 20% buffer if estimate exists

        const txResponse: providers.TransactionResponse = await aggregatorContract.submitVerificationResult(
            requestContext,
            agentId,
            verdict,
            confidenceUint8,
            evidenceCid,
            txOptions
        );

        console.log(`[FVM Contract Service] submitVerificationResult transaction sent. Hash: ${txResponse.hash}`);
        // Don't wait for confirmation by default in service layer for responsiveness
        // Agents might handle waiting/retries if needed
        return txResponse.hash;

    } catch (error: any) {
        console.error(`[FVM Contract Service] Error submitting verification for context ${requestContext}:`, error.message || error);
        return null;
    }
}

/**
 * Triggers the aggregation process on the Aggregator contract for a specific request context.
 * This would typically be called after enough verification verdicts have been submitted.
 * @param requestContext The unique identifier for the request to aggregate.
 * @returns The transaction hash if successful, otherwise null.
 */
export async function triggerAggregation(
    requestContext: string
): Promise<string | null> {
     if (!isFvmServiceInitialized || !aggregatorContract || !wallet) {
        console.error('[FVM Contract Service] Service not initialized. Cannot trigger aggregation.');
        return null;
    }
    console.log(`[FVM Contract Service] Triggering aggregation for context: ${requestContext.substring(0,10)}...`);

    try {
        // Optional Gas Estimation
        let estimatedGas: BigNumber | undefined;
        try {
            estimatedGas = await aggregatorContract.estimateGas.aggregateResults(requestContext);
             console.log(`[FVM Contract Service DEBUG] Estimated Gas for aggregateResults: ${estimatedGas.toString()}`);
        } catch (simError: any) {
             let reason = simError.reason || simError.error?.data?.message || simError.data?.message || simError.message;
             console.error(`[FVM Contract Service DEBUG] Gas estimation/simulation FAILED for aggregateResults: ${reason}`);
             if (reason?.toLowerCase().includes('revert')) {
                throw new Error(`Transaction simulation reverted: ${reason}`);
             }
             console.warn(`[FVM Contract Service] Proceeding without gas estimate due to simulation error.`);
             estimatedGas = undefined;
        }

        const txOptions = { gasLimit: estimatedGas ? estimatedGas.mul(120).div(100) : undefined };

        const txResponse: providers.TransactionResponse = await aggregatorContract.aggregateResults(
            requestContext,
            txOptions
        );

        console.log(`[FVM Contract Service] aggregateResults transaction sent. Hash: ${txResponse.hash}`);
        return txResponse.hash;

    } catch (error: any) {
        console.error(`[FVM Contract Service] Error triggering aggregation for context ${requestContext}:`, error.message || error);
        return null;
    }
}

/**
 * Registers an agent ID with a payout address. Needed before an agent can submit results.
 * @param agentId The unique identifier for the agent.
 * @param payoutAddress The ETH address for receiving rewards.
 * @returns The transaction hash if successful, otherwise null.
 */
export async function registerAgent(
    agentId: string,
    payoutAddress: string
): Promise<string | null> {
     if (!isFvmServiceInitialized || !aggregatorContract || !wallet) {
        console.error('[FVM Contract Service] Service not initialized. Cannot register agent.');
        return null;
    }
     if (!ethers.utils.isAddress(payoutAddress)) {
         console.error(`[FVM Contract Service] Invalid payout address provided for agent ${agentId}: ${payoutAddress}`);
         return null;
     }
     console.log(`[FVM Contract Service] Registering agent | ID: ${agentId}, Payout Address: ${payoutAddress}`);

     try {
         // Add gas estimation if desired
         const txResponse: providers.TransactionResponse = await aggregatorContract.registerAgent(
             agentId,
             payoutAddress
         );
         console.log(`[FVM Contract Service] registerAgent transaction sent. Hash: ${txResponse.hash}`);
         return txResponse.hash;
     } catch (error: any) {
         const message = error.message || error;
         console.error(`[FVM Contract Service] Error registering agent ${agentId}:`, message);
         // Check for common errors like 'Agent already registered' if the contract reverts with specific reasons
         if (message.includes('Agent already registered')) { // Example check
             console.warn(`[FVM Contract Service] Agent ${agentId} might already be registered.`);
         }
         return null;
     }
}

// Add other Aggregator contract interactions as needed:
// - registerEvidence(cid, submitter, dealId)
// - getAgentAddress(agentId) -> returns address
// - getSubmissions(requestContext) -> returns VerifierSubmission[]
// - getAggregatedVerdict(requestContext) -> returns AggregatedVerdict
// - getEvidenceInfo(cid) -> returns EvidenceInfo
// - depositFunds() (payable)
// - withdrawFunds(amount)
// ==== ./services/fvmContractService.ts ====