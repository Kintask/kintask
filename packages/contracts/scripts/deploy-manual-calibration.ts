// scripts/deploy-manual-calibration.ts
import hre from "hardhat";
// Import ethers v6 - Hardhat environment often provides hre.ethers using the installed version
import { ethers, Contract, Overrides, ContractFactory, TransactionResponse, ContractTransactionResponse, TransactionReceipt } from "ethers";
import dotenv from 'dotenv';
import path from 'path';

// --- Load .env file ---
const envPath = path.resolve(__dirname, "../../.env"); // Adjust path to your root .env if needed
dotenv.config({ path: envPath });
console.log(`[Manual Deploy Script] Loading .env from: ${envPath}`);

// --- Configuration ---
const MAX_DEPLOYMENT_RETRIES = 5; // Max attempts to *send* the deployment transaction
const RETRY_DELAY_MS = 15000;     // 15 seconds between *deployment attempt* retries
const FIXED_WAIT_FOR_CONFIRMATION_MS = 1 * 60 * 1000; // <<< Fixed 15 MINUTES wait AFTER sending TX
// const FIXED_WAIT_FOR_CONFIRMATION_MS = 1 * 60 * 1000; // Example: Shorter 1 min wait for testing
// --- End Configuration ---


/**
 * Helper function to get the deployer signer from Hardhat and log its details.
 */
async function getDeployer(): Promise<ethers.Signer> { // Ethers v6 Signer type
    const [deployer] = await hre.ethers.getSigners();
    if (!deployer) { throw new Error("Could not get deployer signer."); }
    console.log("Deploying contracts with the account:", deployer.address);
    const balance = await hre.ethers.provider.getBalance(deployer.address);
    console.log("Account balance:", ethers.formatEther(balance)); // Ethers v6 formatEther
    if (balance === 0n) { console.warn("⚠️ WARNING: Deployer account has zero balance!"); }
    return deployer;
}

/**
 * Helper Function for Fixed Delay
 */
async function wait(ms: number, message: string = "Waiting") {
    if (ms <= 0) return;
    const waitSeconds = Math.round(ms / 1000);
    const waitMinutes = (ms / 1000 / 60).toFixed(1);
    console.log(`--- ${message} (${waitMinutes} minutes)... ---`);
    await new Promise(resolve => setTimeout(resolve, ms));
    console.log(`--- Wait finished. ---`);
}

/**
 * Helper to check if an error message indicates a likely intermittent network/timeout error
 * suitable for retrying the *sending* of a transaction.
 */
function isRetryableSendError(error: any): boolean {
    const message = String(error?.message || error).toLowerCase();
    const code = error?.code || "";
    // Focus on errors happening BEFORE or DURING transaction sending
    return code === "UND_ERR_CONNECT_TIMEOUT" ||
           code === 'TIMEOUT' || // General timeout during send attempt
           code === 'NETWORK_ERROR' ||
           code === 'ECONNRESET' ||
           code === 'ECONNABORTED' ||
           code === 'ETIMEDOUT' ||
           message.includes('timeout') || // Catch generic timeout messages during send
           message.includes('failed to fetch') ||
           message.includes('network connection lost') ||
           code === 'REPLACEMENT_UNDERPRICED' || // Nonce/fee related errors
           code === 'NONCE_EXPIRED' ||
           message.includes('nonce too low') ||
           // Include the specific error if TX wasn't mined after our fixed wait
           message.includes('transaction not mined after fixed wait');
}


/**
 * Deploys a contract with retries for SENDING network/timeout issues,
 * and uses a fixed, long setTimeout delay before checking for confirmation.
 */
async function deployContractWithFixedWait(
  factory: ContractFactory,
  deployArgs: any[], // Last element MUST be overrides or {}
  maxRetries = MAX_DEPLOYMENT_RETRIES,
  sendRetryDelayMs = RETRY_DELAY_MS,
  confirmationWaitMs = FIXED_WAIT_FOR_CONFIRMATION_MS
): Promise<Contract> { // Return type is Contract
  const name = factory.interface.name || "Contract";
  let lastError: any = null;

  // Reliably separate constructor args from overrides
  let overrides: Overrides = {};
  let constructorArgs = [...deployArgs];
  if (constructorArgs.length > 0) {
      const potentialOverrides = constructorArgs[constructorArgs.length - 1];
      if (typeof potentialOverrides === 'object' && potentialOverrides !== null && !Array.isArray(potentialOverrides) &&
          (potentialOverrides.gasLimit !== undefined || potentialOverrides.gasPrice !== undefined || potentialOverrides.maxFeePerGas !== undefined || potentialOverrides.maxPriorityFeePerGas !== undefined || potentialOverrides.value !== undefined || potentialOverrides.nonce !== undefined || Object.keys(potentialOverrides).length === 0)
      ) {
          overrides = constructorArgs.pop();
          console.log(`[Deploy ${name}] Using passed overrides:`, JSON.stringify(overrides, (k, v) => typeof v === 'bigint' ? v.toString() : v));
      } else { console.log(`[Deploy ${name}] No overrides object in last argument.`); }
  } else { console.log(`[Deploy ${name}] No deployment arguments provided.`); }


  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`\n[Deploy ${name}] Deployment Attempt ${attempt}/${maxRetries}...`);
    let contractInstance: Contract | null = null;
    let deploymentTxResponse: ContractTransactionResponse | null = null;
    let txHash: string | null = null;

    try {
        // --- Attempt to SEND the transaction ---
        console.log(`[Deploy ${name}] Sending deployment transaction with args: ${constructorArgs.length > 0 ? JSON.stringify(constructorArgs) : 'None'}`);
        contractInstance = await factory.deploy(...constructorArgs, overrides);
        deploymentTxResponse = contractInstance.deploymentTransaction();

        if (!deploymentTxResponse) { throw new Error("factory.deploy() did not return a deployment transaction response."); }
        txHash = deploymentTxResponse.hash;
        console.log(`[Deploy ${name}] TX Sent! Hash: ${txHash}.`);
        // --- Transaction Sent Successfully ---

        // --- Manual Fixed Wait for Confirmation ---
        await wait(confirmationWaitMs, `Waiting ${confirmationWaitMs / 1000 / 60} min for ${name} TX confirmation`);
        // --- End Manual Fixed Wait ---

        // --- Check Receipt AFTER the delay ---
        console.log(`[Deploy ${name}] Checking receipt for TX: ${txHash}...`);
        // Use the provider associated with the factory's signer (or hre provider)
        const provider = factory.runner?.provider ?? hre.ethers.provider;
        const receipt = await provider.getTransactionReceipt(txHash);

        if (receipt === null) {
            console.error(`[Deploy ${name}] Transaction ${txHash} STILL not mined after fixed wait.`);
            throw new Error(`Transaction not mined after fixed wait (TX Hash: ${txHash})`); // Treat as retryable
        }

        console.log(`[Deploy ${name}] TX Receipt Found. Status: ${receipt.status === 1 ? 'Success' : 'Failed'}, Block: ${receipt.blockNumber}`);
        if (receipt.status !== 1) {
            console.error(`[Deploy ${name}] Transaction ${txHash} reverted!`);
            let reason = "Unknown Revert Reason"; try { const tx = await provider.getTransaction(txHash); if (tx) { const code = await provider.call({ ...tx, blockTag: receipt.blockNumber }); reason = ethers.toUtf8String('0x' + code.substring(138)); console.error(`[Deploy ${name}] Revert Reason (attempted decode): ${reason}`); } } catch (reasonError) { console.warn(`[Deploy ${name}] Could not decode revert reason.`); }
            throw new Error(`Deployment transaction ${txHash} failed (reverted). Reason: ${reason}`); // Non-retryable
        }

        // If receipt status is 1, deployment was successful
        const deployedAddress = receipt.contractAddress;
        if (!deployedAddress) { throw new Error(`Transaction ${txHash} succeeded but receipt missing contract address.`); }

        // Attach factory to the deployed address to return a usable Contract instance
        const deployedContract = factory.attach(deployedAddress) as Contract;
        console.log(`[Deploy ${name}] ✅ Contract deployed successfully on attempt ${attempt} to ${deployedAddress}`);
        return deployedContract; // SUCCESS!

    } catch (error: any) {
        lastError = error;
        let errMsg = error.message; let code = error.code || "UNKNOWN_CODE"; let isRetryableError = false;
        if (error.error?.message) errMsg = error.error.message; if (error.error?.code) code = error.error.code; if (error.reason) errMsg = `${errMsg} (Reason: ${error.reason})`;

        console.error(`[Deploy ${name}] ❌ Attempt ${attempt} FAILED! Code: ${code}`);
        console.error(`[Deploy ${name}] Error Message: ${errMsg}`);
        if (txHash) { console.error(`[Deploy ${name}] Failing TX Hash (if sent): ${txHash}`); }
        else { console.error(`[Deploy ${name}] Transaction may not have been sent successfully.`); }

        // Determine if Retry is Appropriate (Only retry errors related to SENDING the TX or the fixed wait timeout)
        isRetryableError = isRetryableSendError(error); // Use the helper

        if (isRetryableError && attempt < maxRetries) {
            const waitSeconds = sendRetryDelayMs / 1000;
            console.log(`[Deploy ${name}] Waiting ${waitSeconds} seconds before retrying deployment attempt ${attempt + 1}/${maxRetries}...`);
            await new Promise((resolve) => setTimeout(resolve, sendRetryDelayMs));
            // continue to the next iteration of the loop to RESEND the transaction
        } else {
            // Max retries reached for a retryable error, or encountered a non-retryable error (like revert)
            if (isRetryableError) { console.error(`[Deploy ${name}] Max retries (${maxRetries}) reached after retryable error.`); }
            else { console.error(`[Deploy ${name}] Non-retryable error encountered (e.g., revert, insufficient funds). Throwing.`); }
            throw lastError; // Re-throw the last encountered error
        }
    } // End catch
  } // End for loop

  // Should only be reached if loop finishes due to max send retries
  console.error(`[Deploy ${name}] Deployment failed: Could not successfully send transaction after ${maxRetries} attempts.`);
  throw lastError; // Throw the last error encountered
}


// --- Main Deployment Function ---
async function main() {
  const network = hre.network.name;
  console.log(`\n🚀 Starting MANUAL deployment sequence on network: ${network}`);
  console.log("========================================================");

  const deployer = await getDeployer();

  // --- Deployment Overrides ---
  console.log("Setting deployment transaction overrides (generous fees)...");
  const overrides: Overrides = {
    maxPriorityFeePerGas: ethers.parseUnits('5', 'gwei'), // Ethers v6 parseUnits
    maxFeePerGas: ethers.parseUnits('200', 'gwei'), // Ethers v6 parseUnits
    // gasLimit: 15000000n // Example: Uncomment/set if needed
  };
  console.log("Overrides:", { maxPriorityFeePerGas: overrides.maxPriorityFeePerGas?.toString(), maxFeePerGas: overrides.maxFeePerGas?.toString(), gasLimit: overrides.gasLimit?.toString() || 'Estimate' });
  console.log("--------------------------------------------------------");

  // Declare variables
  let schemaRegistry: Contract, eas: Contract, verifier: Contract, answerStatement: Contract, erc20PaymentStatement: Contract, stringResultStatement: Contract, zkpValidator: Contract;
  let schemaRegistryAddress: string, easAddress: string, verifierAddress: string, answerStatementAddress: string, erc20PaymentStatementAddress: string, stringResultStatementAddress: string, zkpValidatorAddress: string;
  let answerStatementSchemaUID: string;
  const zeroHash = ethers.ZeroHash; // Ethers v6 ZeroHash

  try {
    // Deployments using deployContractWithFixedWait, passing overrides as the last element
    console.log("\nDeploying SchemaRegistry...");
    const SchemaRegistryFactory = await hre.ethers.getContractFactory("SchemaRegistry", deployer);
    schemaRegistry = await deployContractWithFixedWait(SchemaRegistryFactory, [overrides]);
    schemaRegistryAddress = await schemaRegistry.getAddress();
    console.log(` -> SchemaRegistry assumed deployed to: ${schemaRegistryAddress}`);

    console.log("\nDeploying EAS...");
    const EASFactory = await hre.ethers.getContractFactory("EAS", deployer);
    eas = await deployContractWithFixedWait(EASFactory, [schemaRegistryAddress, overrides]);
    easAddress = await eas.getAddress();
    console.log(` -> EAS assumed deployed to: ${easAddress}`);

    console.log("\nDeploying Verifier (AlwaysTrue)...");
    const VerifierFactory = await hre.ethers.getContractFactory("contracts/AlwaysTrueVerifier.sol:Groth16Verifier", deployer);
    verifier = await deployContractWithFixedWait(VerifierFactory, [overrides]);
    verifierAddress = await verifier.getAddress();
    console.log(` -> Verifier assumed deployed to: ${verifierAddress}`);

    console.log("\nDeploying AnswerStatement...");
    const AnswerStatementFactory = await hre.ethers.getContractFactory("AnswerStatement", deployer);
    answerStatement = await deployContractWithFixedWait(AnswerStatementFactory, [easAddress, schemaRegistryAddress, overrides]);
    answerStatementAddress = await answerStatement.getAddress();
    console.log(` -> AnswerStatement assumed deployed to: ${answerStatementAddress}`);

    // --- Read AnswerStatement Schema UID ---
    console.log("\nReading AnswerStatement Schema UID (after waiting for AnswerStatement deployment)...");
    // Add small delay before reading state, just in case
    await wait(10000, "Short extra wait before reading schema"); // Wait 10 seconds
    const deployedAnswerStatement = AnswerStatementFactory.attach(answerStatementAddress).connect(hre.ethers.provider);
    try {
         answerStatementSchemaUID = await deployedAnswerStatement.ATTESTATION_SCHEMA();
         if (!answerStatementSchemaUID || answerStatementSchemaUID === zeroHash) { throw new Error(`Read zero hash as Schema UID from ${answerStatementAddress}`); }
         console.log(` -> Read Schema UID: ${answerStatementSchemaUID}`);
    } catch (readError: any) { console.error(` -> FAILED to read schema UID directly: ${readError.message}`); throw new Error(`Could not read ATTESTATION_SCHEMA after deploying AnswerStatement.`); }
     // Optional slightly longer wait after successful read before next deploy
     await wait(15000, "Wait after reading schema");


    console.log("\nDeploying ZKPValidator...");
    const ZKPValidatorFactory = await hre.ethers.getContractFactory("ZKPValidator", deployer);
    zkpValidator = await deployContractWithFixedWait(ZKPValidatorFactory, [easAddress, schemaRegistryAddress, verifierAddress, answerStatementSchemaUID, overrides]);
    zkpValidatorAddress = await zkpValidator.getAddress();
    console.log(` -> ZKPValidator assumed deployed to: ${zkpValidatorAddress}`);

    console.log("\nDeploying ERC20PaymentStatement...");
    const ERC20PaymentStatementFactory = await hre.ethers.getContractFactory("ERC20PaymentStatement", deployer);
    erc20PaymentStatement = await deployContractWithFixedWait(ERC20PaymentStatementFactory, [easAddress, schemaRegistryAddress, overrides]);
    erc20PaymentStatementAddress = await erc20PaymentStatement.getAddress();
    console.log(` -> ERC20PaymentStatement assumed deployed to: ${erc20PaymentStatementAddress}`);

    console.log("\nDeploying StringResultStatement...");
    const StringResultStatementFactory = await hre.ethers.getContractFactory("StringResultStatement", deployer);
    stringResultStatement = await deployContractWithFixedWait(StringResultStatementFactory, [easAddress, schemaRegistryAddress, overrides]);
    stringResultStatementAddress = await stringResultStatement.getAddress();
    console.log(` -> StringResultStatement assumed deployed to: ${stringResultStatementAddress}`);

    // --- Final Summary ---
    console.log("\n================ DEPLOYMENT COMPLETE ================");
    console.log(` Network: ${network} (Chain ID: ${hre.network.config.chainId})`);
    console.log("--------------------------------------------------");
    console.log("  Core Contracts:");
    console.log(`    SchemaRegistry:        ${schemaRegistryAddress}`);
    console.log(`    EAS:                   ${easAddress}`);
    console.log(`    Verifier:              ${verifierAddress}`);
    console.log("--------------------------------------------------");
    console.log("  Statement Contracts:");
    console.log(`    AnswerStatement:       ${answerStatementAddress}`);
    console.log(`    ERC20PaymentStatement: ${erc20PaymentStatementAddress}`);
    console.log(`    StringResultStatement: ${stringResultStatementAddress}`);
    console.log("--------------------------------------------------");
    console.log("  Validator Contracts:");
    console.log(`    ZKPValidator:          ${zkpValidatorAddress}`);
    console.log("==================================================");
    console.log("\n✅ Deployment sequence finished successfully!");
    console.log("ℹ️  Update your .env file with these addresses.");

  } catch (error: any) {
    console.error("\n❌ Manual Deployment FAILED:");
    let errMsg = error.message; if (error.code) errMsg += ` (code: ${error.code})`; if (error.reason) errMsg += ` (reason: ${error.reason})`; if (error.transaction?.hash) errMsg += ` (tx: ${error.transaction.hash})`; else if (error.transactionHash) errMsg += ` (txHash: ${error.transactionHash})`; console.error(` -> Error: ${errMsg}`); console.error("Check transaction hash on explorer and verify your account balance/nonce if applicable."); console.error(error); process.exit(1);
  }
} // End of main

main().catch((error) => {
  console.error("\n❌ Unhandled error in deployment script execution:");
  console.error(error);
  process.exit(1);
});