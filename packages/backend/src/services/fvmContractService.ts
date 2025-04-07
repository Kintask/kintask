// src/services/fvmContractService.ts
import { ethers, Wallet, Contract, providers, BigNumber } from 'ethers';
import config from '../config';
// @ts-ignore ABI type safety is less critical here, focus on functionality
import AggregatorAbi from '../contracts/abi/Aggregator.json';

// --- Module State ---
let provider: providers.StaticJsonRpcProvider | null = null;
let wallet: Wallet | null = null;
let aggregatorContract: Contract | null = null; // Keep for interaction functions
let isFvmServiceInitialized = false;
let successfulRpcUrl: string | null = null;
// --- Promise to track initialization ---
let initializationPromise: Promise<boolean> | null = null;

/**
 * Attempts to create a provider using a list of RPC URLs.
 * Returns the first successful provider and the URL used.
 */
async function attemptProviders(rpcUrls: string[]): Promise<{ provider: providers.StaticJsonRpcProvider, url: string } | null> {
    for (const url of rpcUrls) {
        if (!url) continue;
        console.log(`[FVM Contract Service] Attempting connection via RPC: ${url}`);
        try {
            const tempProvider = new providers.StaticJsonRpcProvider(url);
            // Perform a quick network check to ensure connectivity
            await tempProvider.getNetwork();
            console.log(`[FVM Contract Service] Successfully connected to RPC: ${url}`);
            return { provider: tempProvider, url: url };
        } catch (error: any) {
            console.warn(`[FVM Contract Service] Failed to connect via RPC ${url}: ${error.message}`);
        }
    }
    console.error("[FVM Contract Service] Exhausted all RPC URLs. Could not establish provider connection.");
    return null;
}


// --- Initialize FVM Service with RPC Fallback & Direct Call Test ---
async function initializeFvmServiceInternal(): Promise<boolean> {
    // Prevent re-initialization if already done or in progress
    if (isFvmServiceInitialized) return true;
    console.log("[FVM Contract Service] Attempting initialization...");

    // Get config within the async function scope
    const rpcUrls = config.fvmRpcFallbackUrls;
    const privateKey = config.recallPrivateKey;
    const contractAddress = config.fvmAggregatorContractAddress;
    // @ts-ignore ABI type safety
    const contractAbi = AggregatorAbi.abi;

    try {
        // Basic config validation
        if (!rpcUrls || rpcUrls.length === 0 || !privateKey || !contractAddress) {
            throw new Error("Missing required FVM config (RPC URLs, RECALL_PRIVATE_KEY, or FVM_AGGREGATOR_CONTRACT_ADDRESS).");
        }
        if (!contractAbi || contractAbi.length === 0) {
            throw new Error("Aggregator ABI missing or empty.");
        }

        // Attempt to connect to a working RPC provider
        const providerResult = await attemptProviders(rpcUrls);
        if (!providerResult) {
             throw new Error("Failed provider connection to any configured RPC URL.");
        }

        provider = providerResult.provider; // Assign the working provider
        successfulRpcUrl = providerResult.url;
        wallet = new Wallet(privateKey, provider); // Create wallet with working provider
        console.log(`[FVM Contract Service] Using Wallet: ${wallet.address} via RPC: ${successfulRpcUrl}`);

        // --- Direct eth_call for owner() as primary check ---
        const ownerFunctionSignature = "0x8da5cb5b"; // Signature hash for owner()
        console.log(`[FVM Contract Service] Performing direct eth_call check for owner() at ${contractAddress} via ${successfulRpcUrl}...`);
        try {
            const callResult = await provider.call({
                to: contractAddress,
                data: ownerFunctionSignature
            });
            console.log(`[FVM Contract Service] Direct eth_call result: ${callResult}`);

            if (callResult && callResult !== "0x" && callResult !== "0x0") {
                 // Decode the result (ethers pads addresses)
                 const decodedOwner = ethers.utils.defaultAbiCoder.decode(['address'], callResult)[0];
                 console.log(`✅ Direct eth_call successful. Decoded Owner: ${decodedOwner}`);

                 // Now that direct call worked, create the contract instance for interactions
                 // @ts-ignore ABI type safety
                 aggregatorContract = new Contract(contractAddress, contractAbi, wallet);
                 console.log(`[FVM Contract Service] Contract instance created at: ${aggregatorContract.address}`);

                 isFvmServiceInitialized = true; // Set flag AFTER successful check
                 console.log("[FVM Contract Service] Initialization complete.");
                 return true; // SUCCESS

            } else {
                 console.error(`[FVM Contract Service] Direct eth_call returned empty or zero data: ${callResult}. Contract state might be invalid or inaccessible.`);
                  throw new Error(`Direct eth_call for owner() returned invalid data: ${callResult}`); // Force failure
            }
        } catch (ethCallError: any) {
             console.error(`[FVM Contract Service] Direct eth_call FAILED: ${ethCallError.message || ethCallError}`);
             // Log nested RPC error if available
             if(ethCallError.error?.body || ethCallError.error?.message){
                 const errorBody = JSON.stringify(ethCallError.error.body || ethCallError.error.message);
                 console.error("   RPC Error Details:", errorBody);
                 if (errorBody.includes('actor not found')){
                     console.error("   >> Hint: RPC node reports 'actor not found'. Verify address and network deployment.");
                 }
             }
             throw ethCallError; // Re-throw to be caught by outer catch
        }

    } catch (error: any) { // Catch errors from config check, provider connection, or eth_call
         console.error(`[FVM Contract Service] Initialization failed: ${error.message || error}`);
         // Reset state variables on any initialization failure
         isFvmServiceInitialized = false;
         provider = null;
         wallet = null;
         aggregatorContract = null;
         successfulRpcUrl = null;
         initializationPromise = null; // Allow retrying initialization later if needed
         return false; // Indicate initialization failure
    }
}

/**
 * Ensures the service is initialized and returns the contract instance.
 * Throws an error if initialization failed or is in progress unsuccessfully.
 */
async function getContractInstance(): Promise<Contract> {
    // Start initialization if it hasn't begun or if it previously failed
    if (!initializationPromise) {
        initializationPromise = initializeFvmServiceInternal();
    }

    const success = await initializationPromise; // Wait for initialization to finish

    // Check if initialization was successful and contract instance exists
    if (!success || !aggregatorContract) {
        console.error("[FVM Contract Service] getContractInstance called but service is not initialized or failed initialization.");
        // Reset promise to allow re-initialization attempt on next call
        initializationPromise = null;
        throw new Error("FVM Contract Service failed to initialize or contract instance is unavailable.");
    }
    // If successful, return the instance
    return aggregatorContract;
}


// --- Contract Interaction Functions ---
// Modified to await getContractInstance() before interacting

export async function submitVerificationResult(
    requestContext: string, agentId: string, verdict: string, confidence: number, evidenceCid: string
): Promise<string | null> {
    try {
        const contract = await getContractInstance(); // Wait for/get initialized instance
        // Scale confidence if input is 0-100, otherwise assume 0-1 and scale up
        const confidenceUint8 = (confidence >= 0 && confidence <= 1)
            ? Math.max(0, Math.min(255, Math.round(confidence * 255)))
            : Math.max(0, Math.min(255, Math.round(confidence))); // Assume 0-255 if > 1

        console.log(`[FVM Contract Service] Submitting verification: Context=${requestContext.substring(0,6)} Agent=${agentId.substring(0,10)} Verdict=${verdict} Conf=${confidenceUint8}/255`);
        const txOptions = { gasLimit: 3_000_000 }; // Example manual limit, TUNE!
        const txResponse: providers.TransactionResponse = await contract.submitVerificationResult(
            requestContext, agentId, verdict, confidenceUint8, evidenceCid, txOptions
        );
        console.log(`[FVM Contract Service] submitVerificationResult tx sent: ${txResponse.hash}`);
        return txResponse.hash;
    } catch (error: any) {
        // Log error including context for better debugging
        console.error(`[FVM Contract Service] Error submitting verification for context ${requestContext}:`, error.message || error);
        return null;
    }
}

export async function triggerAggregation(requestContext: string): Promise<string | null> {
     try {
        const contract = await getContractInstance(); // Wait for/get initialized instance
        console.log(`[FVM Contract Service] Triggering aggregation for context: ${requestContext.substring(0,10)}...`);
        const txOptions = { gasLimit: 5_000_000 }; // Aggregation might be expensive, TUNE!
        const txResponse: providers.TransactionResponse = await contract.aggregateResults(requestContext, txOptions);
        console.log(`[FVM Contract Service] aggregateResults tx sent: ${txResponse.hash}`);
        return txResponse.hash;
    } catch (error: any) {
        console.error(`[FVM Contract Service] Error triggering aggregation for context ${requestContext}:`, error.message || error);
        return null;
    }
}

export async function registerAgent(agentId: string, payoutAddress: string): Promise<string | null> {
     try {
        const contract = await getContractInstance(); // Wait for/get initialized instance
        if (!ethers.utils.isAddress(payoutAddress)) {
            console.error(`[FVM Service] Invalid payout address provided for agent ${agentId}: ${payoutAddress}`);
            return null;
        }
        console.log(`[FVM Contract Service] Registering agent: ID=${agentId}, Payout=${payoutAddress}`);
         // Add gas limit if necessary, consult contract gas usage
        const txOptions = { gasLimit: 1_000_000 }; // Example limit
        const txResponse: providers.TransactionResponse = await contract.registerAgent(agentId, payoutAddress, txOptions);
        console.log(`[FVM Contract Service] registerAgent tx sent: ${txResponse.hash}`);
        return txResponse.hash;
     } catch (error: any) {
         console.error(`[FVM Contract Service] Error registering agent ${agentId}:`, error.message || error);
         return null;
     }
}

// Call initialization when the module loads, store the promise
// Subsequent calls to exported functions will await this promise via getContractInstance.
initializationPromise = initializeFvmServiceInternal();

// ==== ./src/services/fvmContractService.ts ====