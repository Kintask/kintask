// scripts/deploy-all.ts
import hre from "hardhat";
import { ignition } from "hardhat"; // Import ignition object
import BaseContractsModule from "../ignition/modules/BaseContractsModule";
import ZKPValidatorModule from "../ignition/modules/ZKPValidatorModule";
import { Contract } from "ethers"; // Keep Contract type import
// Remove 'ethers' import if ONLY used for HashZero previously
// import { ethers } from "ethers";

async function main() {
  const network = hre.network.name;
  const deploymentMode: "reset" | undefined = "reset"; // Use "reset"

  console.log(`\n🚀 Starting deployment on network: ${network}`);
  if (deploymentMode === "reset") {
    console.warn(`🔥 WARNING: Deployment mode set to 'reset'. Existing deployments on ${network} will be ignored and overwritten!`);
  }
  console.log("===========================================");

  // === Deploy Base Contracts ===
  console.log("\n[Stage 1/3] Deploying BaseContractsModule...");
  const {
    schemaRegistry, eas, verifier, answerStatement, erc20PaymentStatement, stringResultStatement
   } = await ignition.deploy(BaseContractsModule, {
       deploymentStateAction: deploymentMode
   });
  console.log("[Stage 1/3] BaseContractsModule deployment complete.");

  // Get addresses
  const schemaRegistryAddress = await schemaRegistry.getAddress();
  const easAddress = await eas.getAddress();
  const verifierAddress = await verifier.getAddress();
  const answerStatementAddress = await answerStatement.getAddress();
  const erc20PaymentStatementAddress = await erc20PaymentStatement.getAddress();
  const stringResultStatementAddress = await stringResultStatement.getAddress();

  // Log addresses
  console.log("\n--- Base Module Addresses ---");
  console.log(`  SchemaRegistry:        ${schemaRegistryAddress}`);
  console.log(`  EAS:                   ${easAddress}`);
  console.log(`  Verifier:              ${verifierAddress}`);
  console.log(`  AnswerStatement:       ${answerStatementAddress}`);
  console.log(`  ERC20PaymentStatement: ${erc20PaymentStatementAddress}`);
  console.log(`  StringResultStatement: ${stringResultStatementAddress}`);


  // === Read Schema UID ===
  console.log("\n[Stage 2/3] Reading Schema UID from deployed AnswerStatement...");
  const AnswerStatementFactory = await hre.ethers.getContractFactory("AnswerStatement");
  const deployedAnswerStatement = AnswerStatementFactory.attach(answerStatementAddress) as Contract;

  let schemaUID: string | null = null; // Initialize as potentially null
  const zeroHash = "0x0000000000000000000000000000000000000000000000000000000000000000";

  try {
      schemaUID = await deployedAnswerStatement.ATTESTATION_SCHEMA();
      console.log(`[Stage 2/3] Read AnswerStatement Schema UID: ${schemaUID}`);

      // --- Use literal hex string for comparison ---
      if (!schemaUID || schemaUID === zeroHash) {
        // If it read zero hash, throw the error immediately
        throw new Error("Read zero hash as Schema UID from AnswerStatement.");
      }
      // --- End comparison modification ---

  } catch (readError: any) {
      console.error(`[Stage 2/3] FAILED to read schema UID: ${readError.message}`);
      // If the initial read failed, we cannot proceed
      throw new Error(`Failed to read a valid Schema UID from AnswerStatement. Initial read error: ${readError.message}`);
  }

  // If we reach here, schemaUID is valid and non-zero


  // === Deploy ZKP Validator ===
  console.log("\n[Stage 3/3] Deploying ZKPValidatorModule with parameters...");
  const { zkpValidator } = await ignition.deploy(ZKPValidatorModule, {
    parameters: {
      ZKPValidatorModule: {
         answerStatementSchemaUID: schemaUID // Pass the validated, non-zero UID
      }
    },
    deploymentStateAction: deploymentMode
  });
  console.log("[Stage 3/3] ZKPValidatorModule deployment complete.");

  const zkpValidatorAddress = await zkpValidator.getAddress();

  // Log address
  console.log("\n--- ZKP Validator Module Address ---");
  console.log(`  ZKPValidator:          ${zkpValidatorAddress}`);


  // === Final Summary ===
  console.log("\n===========================================");
  console.log("✅ Deployment Sequence Complete!");
  console.log("===========================================");

}

main().catch((error) => {
  console.error("\n❌ Deployment script failed:");
  console.error(error); // Log the actual error object
  process.exitCode = 1;
});