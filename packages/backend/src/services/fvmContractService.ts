// services/fvmContractService.ts (Based on response #36, with ZKP additions and fixes)

import { ethers, Wallet, Contract, providers, BigNumber, ContractReceipt } from 'ethers'; // Added ContractReceipt
import config from '../config'; // Ensure config has addresses and keys

// Import ABIs - Ensure all necessary ABIs are present
import PaymentStatementAbi from "../contracts/abi/ERC20PaymentStatement.json";
import StringResultStatementAbi from "../contracts/abi/StringResultStatement.json"; // Keep if validateResultOnchain is used
import AnswerStatementAbi from "../contracts/abi/AnswerStatement.json";
import ZKPValidatorAbi from "../contracts/abi/ZKPValidator.json";
import EASAbi from "../contracts/abi/EAS.json"; // Needed for parsing EAS logs
import { truncateText } from '../utils'; //


// --- Define Contract Names Type ---
// Added 'zkpValidator' and 'eas'
type ContractName = 'payment' | 'stringResult' | 'answer' | 'zkpValidator' | 'eas';

// --- Module State ---
let provider: providers.StaticJsonRpcProvider | null = null;
let wallet: Wallet | null = null;
// Use a map for contract instances for easier management and consistent access
const contractInstances = new Map<ContractName, Contract>();
let isFvmServiceInitialized = false;
let successfulRpcUrl: string | null = null;
let initializationPromise: Promise<boolean> | null = null;

// Contract addresses from config - ensures all needed addresses are loaded
const contractAddresses: Record<ContractName, string | undefined> = {
    payment: config.erc20PaymentStatementAddress,
    stringResult: config.stringResultStatementAddress, // Keep if used
    answer: config.answerStatementAddress,
    zkpValidator: config.zkpValidatorAddress,
    eas: config.easContractAddress,
};

// Contract ABIs mapping - ensures all needed ABIs are loaded
const contractAbis = {
    payment: PaymentStatementAbi.abi,
    stringResult: StringResultStatementAbi.abi, // Keep if used
    answer: AnswerStatementAbi.abi,
    zkpValidator: ZKPValidatorAbi.abi,
    eas: EASAbi.abi,
};

// --- Helper Functions ---

// Function to attempt connection to multiple RPC URLs
async function attemptProviders(rpcUrls: string[]): Promise<{ provider: providers.StaticJsonRpcProvider; url: string } | null> {
    // Keep this function as it was - robust connection attempts
    for (const url of rpcUrls) {
        if (!url) continue;
        console.log(`[FVM Service] Attempting connection via RPC: ${url}`);
        try {
            const tempProvider = new providers.StaticJsonRpcProvider({ url: url, timeout: 15000 }); // Ethers v5 provider
            await tempProvider.getNetwork();
            console.log(`[FVM Service] Successfully connected to RPC: ${url}`);
            return { provider: tempProvider, url: url };
        } catch (error: any) {
            console.warn(`[FVM Service] Failed to connect via RPC ${url}: ${error.message}`);
        }
    }
    console.error("[FVM Service] Exhausted all RPC URLs. Could not establish provider connection.");
    return null;
}

// Get contract instance, ensuring initialization - Uses the Map
async function getContract(contractName: ContractName): Promise<Contract> {
    await ensureInitialized(); // Ensure service is initialized
    const contract = contractInstances.get(contractName);
    if (!contract) {
        // Provide a more specific error if an essential contract is missing
        if (['payment', 'answer', 'zkpValidator', 'eas'].includes(contractName)) {
             throw new Error(`Essential contract '${contractName}' instance not available. Check config and initialization.`);
        }
        // Less critical for optional contracts, but still an issue if called
        throw new Error(`${contractName} contract instance not available or not initialized.`);
    }
    return contract;
}

// Function to parse logs and find a specific argument from a specific event (Ethers v5)
async function findEventArgsInReceipt(receipt: ethers.ContractReceipt, contractInterface: ethers.utils.Interface, eventName: string, argName: string): Promise<any | null> {
    // Use receipt.events if available (Ethers v5 sometimes populates this)
    const events = receipt.events || [];
    for (const event of events) {
        if (event.event === eventName && event.args && event.args[argName] !== undefined) {
             console.log(`[FVM Service] Found event '${eventName}' (in receipt.events) with arg '${argName}': ${event.args[argName]}`);
            return event.args[argName];
        }
    }
    // Fallback: Manually parse logs if not found in receipt.events
    console.warn(`[FVM Service] Event '${eventName}' not found in receipt.events. Manually parsing logs...`);
    for (const log of receipt.logs || []) {
        try {
            const parsedLog = contractInterface.parseLog(log);
            if (parsedLog.name === eventName) {
                if (parsedLog.args && parsedLog.args[argName] !== undefined) {
                    console.log(`[FVM Service] Found event '${eventName}' (manual parse) with arg '${argName}': ${parsedLog.args[argName]}`);
                    return parsedLog.args[argName];
                } else {
                    console.warn(`[FVM Service] Found event '${eventName}' (manual parse) but argument '${argName}' is missing.`);
                }
            }
        } catch (e) { /* Ignore logs that don't match the interface */ }
    }
    console.warn(`[FVM Service] Event '${eventName}' with argument '${argName}' not found in transaction logs after manual parse.`);
    return null;
}

// Function to robustly find UID, preferring generic EAS event
async function findUIDFromReceipt(
    receipt: ContractReceipt,
    targetSchemaUID: string, // Schema UID of the attestation we're looking for
    easInterface: ethers.utils.Interface, // EAS ABI Interface (ethers v5)
    easAddr: string // EAS Contract Address
): Promise<string | null> {
    console.log(`[FVM UID Helper] Searching logs for EAS Attested event matching schema ${targetSchemaUID}...`);
    const eventSignatureHash = ethers.utils.id("Attested(address,address,bytes32,bytes32)"); // Hash for standard EAS Attested event

    for (const log of receipt.logs || []) {
        // Check Address and Topic 0 (Event Signature)
        if (log.address.toLowerCase() === easAddr.toLowerCase() && log.topics[0] === eventSignatureHash) {
            // Check Topic 3 (Schema UID - indexed[2] in a 0-indexed array)
            // Ensure topics array has enough elements
            if (log.topics.length > 3 && log.topics[3].toLowerCase() === targetSchemaUID.toLowerCase()) {
                 console.log(`[FVM UID Helper] Found potential Attested event with matching schema.`);
                 // The UID is the **third** indexed topic (topics[0] is signature hash)
                 // Ethers Interface.parseLog SHOULD put indexed topics in args by index/name,
                 // but sometimes accessing topics directly is more reliable if parsing fails.
                 // Let's try parsed args first, then fallback to topic.
                 let uid: string | null = null;
                 try {
                     const parsed = easInterface.parseLog(log);
                     if (parsed.name === "Attested") { // Double check name just in case
                          uid = parsed.args.uid; // Try accessing by name
                          // Fallback to index if name access fails (shouldn't usually happen)
                          if (!uid && parsed.args[2]) uid = parsed.args[2];
                     }
                 } catch (parseError) {
                      console.warn("[FVM UID Helper] Error parsing log with EAS interface, attempting direct topic access.", parseError);
                 }

                 // If parsing failed or didn't yield UID, try direct topic access
                 // The UID is indexed[2] -> topics[3]
                 if (!uid && log.topics.length > 3) {
                     uid = log.topics[2]; // **Correction: UID is Topic 2 (indexed[1])** wait, let me re-check EAS source...
                     // *** Correction: Standard EAS Attested indexes recipient[1], attester[2], uid[3] ***
                     // So uid should be topics[3] if it's the 3rd indexed param. Let's stick with parsed.args first.
                     // Let's retry the direct topic index based on standard event:
                     // topics[0]=sig, topics[1]=recipient, topics[2]=attester, topics[3]=uid
                     if (log.topics.length > 3) {
                         uid = log.topics[3];
                         console.log(`[FVM UID Helper] Using UID from direct topic access: log.topics[3]`);
                     }
                 }


                 // Final validation of the extracted UID
                 if (uid && uid !== ethers.constants.HashZero) {
                      console.log(`[FVM UID Helper] Successfully extracted UID: ${uid}`);
                      return uid;
                 } else {
                      console.warn(`[FVM UID Helper] Found matching Attested event but extracted UID was invalid or zero hash (UID: ${uid}).`);
                 }
            }
        }
    }
    console.error(`[FVM UID Helper] UID not found in EAS Attested events for schema ${targetSchemaUID}.`);
    return null; // Return null if not found
}

// --- Initialization Logic ---
// Initializes provider, wallet, and ALL contract instances defined in mappings
async function initializeFvmServiceInternal(): Promise<boolean> {
    if (isFvmServiceInitialized) { console.log("[FVM Service] Already initialized."); return true; }
    console.log("[FVM Service] Attempting initialization...");

    const isLocalTest = config.isLocalTest;
    const rpcUrls = (isLocalTest ? [config.localRpcUrl] : config.fvmRpcFallbackUrls)?.filter(Boolean) as string[] || [];
    // Use walletPrivateKey for signing, could be local owner or deployed agent key from config
    const privateKey = config.walletPrivateKey || (isLocalTest ? config.recallPrivateKey : undefined); // Ensure a key is selected

    // Config Validation
    if (!rpcUrls || rpcUrls.length === 0) { console.error("[FVM Service] Init failed: No valid RPC URLs."); return false; }
    if (!privateKey) { console.error("[FVM Service] Init failed: No wallet private key (WALLET_PRIVATE_KEY or fallback)."); return false; }
    // Check essential addresses needed for core functionality
    if (!contractAddresses.payment || !contractAddresses.answer || !contractAddresses.zkpValidator || !contractAddresses.eas) {
         console.error("[FVM Service] Init failed: One or more essential contract addresses (Payment, Answer, ZKPValidator, EAS) missing in config.");
         return false; // Make essential addresses mandatory
    }

    try {
        // Establish Provider Connection
        const providerResult = await attemptProviders(rpcUrls);
        if (!providerResult) { throw new Error("Failed provider connection."); }
        provider = providerResult.provider; successfulRpcUrl = providerResult.url;

        // Initialize Wallet
        wallet = new Wallet(privateKey, provider);
        console.log(`[FVM Service] Wallet initialized: ${wallet.address} connected via RPC: ${successfulRpcUrl}`);

        // Initialize Contract Instances using the Map
        contractInstances.clear();
        let initializedCount = 0;
        let essentialContractsOk = true;
        for (const name in contractAddresses) {
            const typedName = name as ContractName;
            const address = contractAddresses[typedName];
            const abi = contractAbis[typedName];
            if (address && abi) { // Only initialize if address and ABI are present
                try {
                    // Use wallet for contracts needing signing, provider for EAS read-only
                    const signerOrProvider = (typedName === 'eas') ? provider : wallet;
                    const contract = new Contract(address, abi, signerOrProvider);
                    // Perform a simple check - e.g., read a public variable or call a simple view function
                    // ATTESTATION_SCHEMA is common in EAS-based contracts
                    if (typeof contract.ATTESTATION_SCHEMA === 'function') {
                        await contract.ATTESTATION_SCHEMA({ blockTag: 'latest' }); // Read schema UID
                         console.log(`[FVM Service] Contract '${typedName}' check OK (read ATTESTATION_SCHEMA). Initialized at: ${address}`);
                    } else if (typedName === 'eas' && typeof contract.VERSION === 'function') {
                         await contract.VERSION({ blockTag: 'latest' }); // Check EAS version
                         console.log(`[FVM Service] Contract '${typedName}' check OK (read VERSION). Initialized at: ${address}`);
                    }
                     else {
                         // Fallback check if no standard view function is known
                         await provider.getCode(address); // Check if code exists at address
                         console.log(`[FVM Service] Contract '${typedName}' check OK (getCode). Initialized at: ${address}`);
                    }

                    contractInstances.set(typedName, contract);
                    initializedCount++;
                } catch (initError: any) {
                    console.error(`[FVM Service] Failed to initialize or verify contract '${typedName}' at ${address}: ${initError.message}`);
                    if (['payment', 'answer', 'zkpValidator', 'eas'].includes(typedName)) {
                         essentialContractsOk = false; // Mark failure if essential contract fails
                    }
                }
            } else if (['payment', 'answer', 'zkpValidator', 'eas'].includes(typedName)) {
                 // If address or ABI is missing for an essential contract
                 console.error(`[FVM Service] Address or ABI missing for essential contract '${typedName}'. Cannot initialize.`);
                 essentialContractsOk = false;
            }
        } // End for loop

        if (!essentialContractsOk) {
             throw new Error("One or more essential contract instances failed to initialize. Check addresses, ABIs, and RPC connection.");
        }
        if (initializedCount === 0) { // Should not happen if essential check passes, but safety check
            throw new Error("No contract instances could be initialized.");
        }

        // Final Health Check
        const balance = await wallet.getBalance();
        console.log(`[FVM Service] Wallet balance: ${ethers.utils.formatEther(balance)} Native`); // Ethers v5 formatEther
        if (balance.isZero()) { console.warn("[FVM Service] Warning: Initialized wallet has zero balance."); }

        isFvmServiceInitialized = true;
        console.log("[FVM Service] Initialization complete.");
        return true;

    } catch (error: any) {
        console.error(`[FVM Service] Initialization failed: ${error.message || error}`);
        isFvmServiceInitialized = false; provider = null; wallet = null; contractInstances.clear(); successfulRpcUrl = null; initializationPromise = null;
        return false;
    }
}

// Ensures the service is initialized using the Map-based logic
async function ensureInitialized(): Promise<boolean> {
    if (!initializationPromise) {
        console.log("[FVM Service] Initialization promise not found, creating...");
        initializationPromise = initializeFvmServiceInternal();
    }
    const success = await initializationPromise;
    if (!success) {
        initializationPromise = null; // Allow retry
        throw new Error("FVM Contract Service failed to initialize.");
    }
    return true;
}


// --- Exported Functions ---

/**
 * Initiates payout by calling collectPayment on ERC20PaymentStatement.
 * fulfillmentUID MUST be the ZKPValidator attestation UID.
 */
export async function payoutToAgentOnchain(paymentUID: string, fulfillmentUID: string): Promise<{ hash: string }> {
    const contract = await getContract('payment'); // Use helper to get instance
    console.log(`[FVM Service] Initiating collectPayment for PaymentUID: ${paymentUID}, FulfillmentUID (Validation UID): ${fulfillmentUID}`);
    try {
        const gasLimit = config.fvmGasLimitCollectPayment || 500000;
        const tx = await contract.collectPayment(paymentUID, fulfillmentUID, { gasLimit });
        console.log(`[FVM Service] collectPayment tx sent: ${tx.hash}. Waiting for confirmation...`);
        const receipt = await tx.wait(1);
        if (receipt.status !== 1) { throw new Error(`collectPayment transaction failed. Hash: ${tx.hash}`); }
        console.log(`[FVM Service] Payment collected successfully in block ${receipt.blockNumber}. Hash: ${tx.hash}`);
        // Optional log parsing kept from original if needed
        // const paymentInterface = new ethers.utils.Interface(PaymentStatementAbi.abi);
        // const collectedAmount = await findEventArgsInReceipt(receipt, paymentInterface, "PaymentCollected", "amount"); // Use await here
        // if (collectedAmount) { console.log(`[FVM Service] PaymentCollected amount: ${collectedAmount.toString()}`); }
        return { hash: tx.hash };
    } catch (error: any) {
        console.error(`[FVM Service] collectPayment failed for PaymentUID ${paymentUID}, FulfillmentUID ${fulfillmentUID}: ${error.message}`);
        throw error;
    }
}

/**
 * Creates an ERC20 Payment Statement on-chain.
 * Expects raw demand string, performs ABI encoding internally.
 */
export async function createPaymentStatement(
    token: string,
    amount: BigNumber,
    arbiter: string,
    demand: string // Expects RAW demand string (e.g., the question)
): Promise<string> {
    const contract = await getContract('payment'); // Use helper

    // --- ABI Encode the demand HERE ---
    console.log(`[FVM Service] Encoding demand string: "${truncateText(demand, 100)}"`);
    let encodedDemand;
    try {
        encodedDemand = ethers.utils.defaultAbiCoder.encode(["string"], [demand]); // Ethers v5
        console.log(`[FVM Service] Encoded demand (bytes): ${encodedDemand}`);
    } catch (encodeError: any) {
         console.error(`[FVM Service] Failed to ABI encode demand string: ${encodeError.message}`);
         throw new Error(`Failed to encode demand: ${encodeError.message}`);
    }
    // --- End Encoding ---

    console.log(`[FVM Service] Creating payment statement: Token=${token}, Amount=${amount.toString()}, Arbiter=${arbiter}`);
    let overrides: ethers.PayableOverrides = { // Use specific type
        gasLimit: config.fvmGasLimitCreatePayment || 800000,
    };
    if (token === ethers.constants.AddressZero) { // Ethers v5 constant
        overrides.value = amount;
        console.log(`[FVM Service] Attaching native value: ${amount.toString()}`);
    } else {
        console.log(`[FVM Service] Using ERC20 token: ${token}. Ensure allowance.`);
    }

    try {
        const tx = await contract.makeStatement( token, amount, arbiter, encodedDemand, overrides ); // Pass encodedDemand
        console.log(`[FVM Service] makeStatement TX sent: ${tx.hash}. Waiting...`);
        const receipt = await tx.wait(1);
        if (receipt.status !== 1) { throw new Error(`makeStatement TX failed. Hash: ${tx.hash}`); }
        console.log(`[FVM Service] makeStatement TX confirmed. Block: ${receipt.blockNumber}`);

        // --- Robust UID Parsing ---
        const paymentSchemaUID = await contract.ATTESTATION_SCHEMA();
        const easIface = new ethers.utils.Interface(EASAbi.abi); // Ethers v5
        const easAddr = contractAddresses.eas; // Get EAS address from config map
        if (!easAddr) throw new Error("EAS Contract address missing in config for UID parsing.");
        const paymentUID = await findUIDFromReceipt(receipt, paymentSchemaUID, easIface, easAddr);

        if (!paymentUID) {
            console.error("[FVM Service] Failed to find Payment UID in logs.", receipt.logs);
            throw new Error("Could not find Payment Statement UID in TX logs.");
        }

        console.log(`[FVM Service] Payment statement created. PaymentUID: ${paymentUID}`);
        return paymentUID;

    } catch (error: any) {
         console.error(`[FVM Service] Error during createPaymentStatement execution: ${error.message}`);
         throw error;
    }
}


/**
 * Calls the ZKPValidator contract to validate a ZKP associated with an AnswerStatement.
 */
export async function validateZKPOnchain(answerUID: string): Promise<string> {
    const contract = await getContract('zkpValidator'); // Use helper
    console.log(`[FVM Service] Initiating ZKP validation for AnswerUID: ${answerUID}`);
    try {
        const gasLimit = config.fvmGasLimitValidateZKP || 1500000;
        const tx = await contract.validateZKP(answerUID, { gasLimit });
        console.log(`[FVM Service] validateZKP TX sent: ${tx.hash}. Waiting...`);
        const receipt = await tx.wait(1);
        if (receipt.status !== 1) { throw new Error(`validateZKP TX failed. Hash: ${tx.hash}`); }
        console.log(`[FVM Service] validateZKP TX confirmed. Block: ${receipt.blockNumber}`);

        // --- Robust UID Parsing ---
        const validatorSchemaUID = await contract.ATTESTATION_SCHEMA();
        const easIface = new ethers.utils.Interface(EASAbi.abi); // Ethers v5
        const easAddr = contractAddresses.eas;
        if (!easAddr) throw new Error("EAS Contract address missing in config for UID parsing.");
        const validationUID = await findUIDFromReceipt(receipt, validatorSchemaUID, easIface, easAddr);

        if (!validationUID) {
            console.error("[FVM Service] Failed to find ZKP Validation UID from EAS Attested event logs.", receipt.logs);
            throw new Error("Could not find ZKP Validation UID in logs after validateZKP.");
        }

        console.log(`[FVM Service] ZKP validation successful. ValidationUID: ${validationUID}`);
        return validationUID;

    } catch (error: any) {
         console.error(`[FVM Service] Error during validateZKPOnchain (AnswerUID: ${answerUID}): ${error.message}`);
         throw error;
    }
}


/**
 * Original validateResultOnchain function (for StringResultStatement arbiter). Kept for reference.
 */
export async function validateResultOnchain(
    fulfillmentUID: string,
    paymentUID: string,
    originalQuery: string
): Promise<boolean> {
    console.warn("[FVM Service] validateResultOnchain using StringResultStatement is likely deprecated for the ZKP flow.");
    try {
        const stringResultContract = await getContract('stringResult');
        const easReadContract = await getContract('eas'); // Use EAS instance for reading
        const paymentContract = await getContract('payment'); // Needed? Only if fetching payment data structure

        console.log(`[FVM Contract Service] Validating StringResult: fulfillmentUID=${fulfillmentUID}, paymentUID=${paymentUID}`);

        // Fetch the full payment attestation struct needed by checkFulfillment
        const paymentAttestation = await easReadContract.getAttestation(paymentUID);
        // Encode the demand as expected by StringResultStatement's checkFulfillment
        const encodedDemand = ethers.utils.defaultAbiCoder.encode(["string"], [originalQuery]); // Ethers v5

        // Call checkFulfillment on the StringResultStatement contract instance
        const isValid = await stringResultContract.checkFulfillment(paymentAttestation, encodedDemand, fulfillmentUID);
        console.log(`[FVM Contract Service] StringResult validation: ${isValid ? 'VALID ✅' : 'INVALID ❌'}`);
        return isValid;
    } catch (error: any) {
         console.error(`[FVM Service] Error during validateResultOnchain (StringResult): ${error.message}`);
         return false; // Return false on error as per original intent
    }
}

// --- Initialize Service ---
// Start initialization immediately
if (!initializationPromise) {
    initializationPromise = initializeFvmServiceInternal();
}
export { ensureInitialized }; // Export if needed externally