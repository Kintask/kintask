import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { Address } from "viem"; // Import Address type if needed elsewhere
import { Contract } from "ethers"; // Import Contract type for read operations

// CoopHive/EAS/ZKP stack + Marketplace deployment module
const CoopHiveZKPModule = buildModule("CoopHiveZKPModule", (m) => {
  // 1. Deploy EAS core contracts
  console.log("Deploying SchemaRegistry...");
  const schemaRegistry = m.contract("SchemaRegistry");
  // m.log("SchemaRegistry deployed to:", schemaRegistry);

  console.log("Deploying EAS...");
  const eas = m.contract("EAS", [schemaRegistry]); // EAS(_schemaRegistry)
  // m.log("EAS deployed to:", eas);

  // 2. Deploy the AlwaysTrue (Groth16) Verifier
  console.log("Deploying Verifier...");
  // Ensure the artifact name matches exactly, including path if needed
  const verifier = m.contract(
    "contracts/AlwaysTrueVerifier.sol:Groth16Verifier"
  );
  // m.log("Verifier deployed to:", verifier);

  // 3. Deploy AnswerStatement with EAS/SR addresses
  console.log("Deploying AnswerStatement...");
  const answerStatement = m.contract("AnswerStatement", [
    eas,
    schemaRegistry,
  ]);
  // m.log("AnswerStatement deployed to:", answerStatement);

  // --- NEW: Read the Schema UID from the deployed AnswerStatement ---
  console.log("Reading AnswerStatement Schema UID...");
  // Use m.readEventArgument for events or m.call for view functions
  // NOTE: Ignition currently (as of early 2024) has limitations reading
  //       simple view function return values directly within the module build phase.
  //       A common workaround is to deploy dependent contracts in separate modules
  //       or use a script *after* deployment to link them.
  //
  //       HOWEVER, let's *try* using m.call - this *might* work depending on Ignition version.
  //       If this fails, you'll need a post-deployment script or separate module.
  const answerStatementSchemaUID_Future = m.call( // Use m.call for view functions
      answerStatement,
      "ATTESTATION_SCHEMA", // Name of the view function in AnswerStatement
      [] // No arguments for this function
      // { id: "getAnswerSchemaUID" } // Optional ID for the call step
  );
  // We get a 'Future' value here. We pass this Future directly to the next contract's constructor args.
  // m.log("AnswerStatement Schema UID (Future):", answerStatementSchemaUID_Future);


  // 4. Deploy ZKPValidator passing EAS, SR, Verifier, and the retrieved Schema UID
  console.log("Deploying ZKPValidator...");
  const zkpValidator = m.contract("ZKPValidator", [
    eas,
    schemaRegistry,
    verifier,
    answerStatementSchemaUID_Future, // <<< PASS THE FUTURE VALUE HERE
  ]);
  // m.log("ZKPValidator deployed to:", zkpValidator);

  // --------- MARKETPLACE CONTRACTS BELOW ----------

  // 5. Deploy ERC20PaymentStatement (Tokens for Strings marketplace)
  console.log("Deploying ERC20PaymentStatement...");
  const erc20PaymentStatement = m.contract("ERC20PaymentStatement", [
    eas,
    schemaRegistry,
  ]);
  // m.log("ERC20PaymentStatement deployed to:", erc20PaymentStatement);

  // 6. Deploy StringResultStatement
  console.log("Deploying StringResultStatement...");
  const stringResultStatement = m.contract("StringResultStatement", [
    eas,
    schemaRegistry,
  ]);
  // m.log("StringResultStatement deployed to:", stringResultStatement);


  // Optionally: add any validators (e.g., OptimisticStringValidator)
  // const optimisticStringValidator = m.contract("OptimisticStringValidator", [ ... ]);

  console.log("Deployment definitions complete.");
  return {
    schemaRegistry,
    eas,
    verifier,
    answerStatement,
    zkpValidator, // Now depends on answerStatementSchemaUID_Future
    erc20PaymentStatement,
    stringResultStatement,
    // optimisticStringValidator, // uncomment if used
  };
});

export default CoopHiveZKPModule;