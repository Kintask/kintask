// ignition/modules/BaseContractsModule.ts
import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const BaseContractsModule = buildModule("BaseContractsModule", (m) => {
  // 1. Deploy EAS core contracts
  const schemaRegistry = m.contract("SchemaRegistry");
  const eas = m.contract("EAS", [schemaRegistry]);

  // 2. Deploy the AlwaysTrue (Groth16) Verifier
  const verifier = m.contract(
    "contracts/AlwaysTrueVerifier.sol:Groth16Verifier"
  );

  // 3. Deploy AnswerStatement with EAS/SR addresses
  const answerStatement = m.contract("AnswerStatement", [
    eas,
    schemaRegistry,
  ]);

  // 4. Deploy other base contracts
  const erc20PaymentStatement = m.contract("ERC20PaymentStatement", [
    eas,
    schemaRegistry,
  ]);

  const stringResultStatement = m.contract("StringResultStatement", [
    eas,
    schemaRegistry,
  ]);

  // Export the deployed contracts needed by the next module/script
  return {
    schemaRegistry,
    eas,
    verifier,
    answerStatement,
    erc20PaymentStatement,
    stringResultStatement,
  };
});

export default BaseContractsModule;