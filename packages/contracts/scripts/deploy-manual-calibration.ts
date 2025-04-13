// scripts/deploy-manual-calibration.ts
import hre from "hardhat";
// Import ethers v6 - Hardhat environment often provides hre.ethers using the installed version
import { ethers, Contract, Overrides, ContractFactory } from "ethers";
import dotenv from 'dotenv';
import path from 'path';

// --- Load .env file ---
const envPath = path.resolve(__dirname, '../../.env'); // Adjust path as needed
dotenv.config({ path: envPath });
console.log(`[Manual Deploy Script] Loading .env from: ${envPath}`);

// --- Helper Function to Get Signer and Log Balance ---
async function getDeployer(): Promise<ethers.Signer> {
    // Use the account configured for the target network in hardhat.config.ts
    const [deployer] = await hre.ethers.getSigners();
    if (!deployer) {
        throw new Error("Could not get deployer signer from Hardhat runtime environment. Check network config and private key.");
    }
    console.log("Deploying contracts with the account:", deployer.address);
    // Use hre provider and ethers v6 formatting
    const balance = await hre.ethers.provider.getBalance(deployer.address);
    console.log("Account balance:", ethers.formatEther(balance)); // <<< Use ethers.formatEther (v6)
    if (balance === 0n) { // Use bigint for comparison
        console.warn("⚠️ WARNING: Deployer account has zero balance! Deployment will likely fail.");
    }
    return deployer;
}

// --- Main Deployment Function ---
async function main() {
    const network = hre.network.name;
    console.log(`\n🚀 Starting MANUAL deployment sequence on network: ${network}`);
    console.log("========================================================");

    const deployer = await getDeployer();

    // --- Define Deployment Overrides (Gas Settings for Ethers v6) ---
    console.log("Setting deployment transaction overrides (increased gas/timeouts)...");
    // Overrides type might be slightly different or just use Record<string, any>
    const overrides: Overrides = { // Use Overrides type from ethers v6
      // Explicit EIP-1559 fees (Values are BigInt in v6)
      maxPriorityFeePerGas: ethers.parseUnits('5', 'gwei'), // <<< Use ethers.parseUnits (v6)
      maxFeePerGas: ethers.parseUnits('200', 'gwei'), // <<< Use ethers.parseUnits (v6)
      // gasLimit: 10000000n, // Example: High limit as BigInt
    };
    console.log("Overrides:", {
        maxPriorityFeePerGas: overrides.maxPriorityFeePerGas?.toString(),
        maxFeePerGas: overrides.maxFeePerGas?.toString(),
        gasLimit: overrides.gasLimit?.toString() || 'Estimate',
    });
    console.log("--------------------------------------------------------");


    // --- Deployment Sequence ---
    let schemaRegistry: Contract, eas: Contract, verifier: Contract, answerStatement: Contract, erc20PaymentStatement: Contract, stringResultStatement: Contract, zkpValidator: Contract;
    let schemaRegistryAddress: string, easAddress: string, verifierAddress: string, answerStatementAddress: string, erc20PaymentStatementAddress: string, stringResultStatementAddress: string, zkpValidatorAddress: string;
    let answerStatementSchemaUID: string;
    const zeroHash = ethers.ZeroHash; // <<< Use ethers.ZeroHash (v6)

    try {
        // 1. Deploy SchemaRegistry
        console.log("Deploying SchemaRegistry...");
        const SchemaRegistryFactory = await hre.ethers.getContractFactory("SchemaRegistry", deployer) as ContractFactory; // Cast needed
        schemaRegistry = await SchemaRegistryFactory.deploy(overrides);
        await schemaRegistry.waitForDeployment(); // <<< Use waitForDeployment (v6)
        schemaRegistryAddress = await schemaRegistry.getAddress(); // <<< Use getAddress (v6)
        console.log(` -> SchemaRegistry deployed to: ${schemaRegistryAddress}`);

        // 2. Deploy EAS
        console.log("Deploying EAS...");
        const EASFactory = await hre.ethers.getContractFactory("EAS", deployer) as ContractFactory;
        eas = await EASFactory.deploy(schemaRegistryAddress, overrides); // Pass SchemaRegistry address
        await eas.waitForDeployment();
        easAddress = await eas.getAddress();
        console.log(` -> EAS deployed to: ${easAddress}`);

        // 3. Deploy Verifier
        console.log("Deploying Verifier (AlwaysTrue)...");
        const VerifierFactory = await hre.ethers.getContractFactory("contracts/AlwaysTrueVerifier.sol:Groth16Verifier", deployer) as ContractFactory;
        verifier = await VerifierFactory.deploy(overrides);
        await verifier.waitForDeployment();
        verifierAddress = await verifier.getAddress();
        console.log(` -> Verifier deployed to: ${verifierAddress}`);

        // 4. Deploy AnswerStatement
        console.log("Deploying AnswerStatement...");
        const AnswerStatementFactory = await hre.ethers.getContractFactory("AnswerStatement", deployer) as ContractFactory;
        answerStatement = await AnswerStatementFactory.deploy(easAddress, schemaRegistryAddress, overrides);
        await answerStatement.waitForDeployment();
        answerStatementAddress = await answerStatement.getAddress();
        console.log(` -> AnswerStatement deployed to: ${answerStatementAddress}`);

        // 5. *** Read AnswerStatement Schema UID ***
        console.log("Reading AnswerStatement Schema UID...");
        // Cast the deployed contract to the correct type if needed for type checking, or use 'as any'/'as Contract'
        const deployedAnswerStatement = AnswerStatementFactory.attach(answerStatementAddress) as Contract; // Attach returns BaseContract, cast if needed
        answerStatementSchemaUID = await deployedAnswerStatement.ATTESTATION_SCHEMA();
        if (!answerStatementSchemaUID || answerStatementSchemaUID === zeroHash) { // <<< Use v6 ZeroHash
            throw new Error(`Failed to read valid ATTESTATION_SCHEMA from deployed AnswerStatement at ${answerStatementAddress}`);
        }
        console.log(` -> Read Schema UID: ${answerStatementSchemaUID}`);

        // 6. Deploy ZKPValidator
        console.log("Deploying ZKPValidator...");
        const ZKPValidatorFactory = await hre.ethers.getContractFactory("ZKPValidator", deployer) as ContractFactory;
        zkpValidator = await ZKPValidatorFactory.deploy(
            easAddress,
            schemaRegistryAddress,
            verifierAddress,
            answerStatementSchemaUID, // Pass the read UID
            overrides
        );
        await zkpValidator.waitForDeployment();
        zkpValidatorAddress = await zkpValidator.getAddress();
        console.log(` -> ZKPValidator deployed to: ${zkpValidatorAddress}`);

        // 7. Deploy ERC20PaymentStatement
        console.log("Deploying ERC20PaymentStatement...");
        const ERC20PaymentStatementFactory = await hre.ethers.getContractFactory("ERC20PaymentStatement", deployer) as ContractFactory;
        erc20PaymentStatement = await ERC20PaymentStatementFactory.deploy(easAddress, schemaRegistryAddress, overrides);
        await erc20PaymentStatement.waitForDeployment();
        erc20PaymentStatementAddress = await erc20PaymentStatement.getAddress();
        console.log(` -> ERC20PaymentStatement deployed to: ${erc20PaymentStatementAddress}`);

        // 8. Deploy StringResultStatement
        console.log("Deploying StringResultStatement...");
        const StringResultStatementFactory = await hre.ethers.getContractFactory("StringResultStatement", deployer) as ContractFactory;
        stringResultStatement = await StringResultStatementFactory.deploy(easAddress, schemaRegistryAddress, overrides);
        await stringResultStatement.waitForDeployment();
        stringResultStatementAddress = await stringResultStatement.getAddress();
        console.log(` -> StringResultStatement deployed to: ${stringResultStatementAddress}`);

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
        let errMsg = error.message;
        if (error.code) errMsg += ` (code: ${error.code})`;
        if (error.reason) errMsg += ` (reason: ${error.reason})`;
        // In ethers v6, transaction details might be on error.transaction
        if (error.transaction?.hash) errMsg += ` (tx: ${error.transaction.hash})`;
        else if (error.transactionHash) errMsg += ` (txHash: ${error.transactionHash})`; // Fallback
        console.error(` -> Error: ${errMsg}`);
        console.error("Check transaction hash on explorer and account balance/nonce if applicable.");
        console.error(error); // Log full error for more details
        process.exit(1); // Exit script on failure
    }
} // End of main

main().catch(error => {
  console.error("\n❌ Unhandled error in deployment script execution:");
  console.error(error);
  process.exit(1);
});