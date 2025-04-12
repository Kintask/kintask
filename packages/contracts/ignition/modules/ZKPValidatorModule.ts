// ignition/modules/ZKPValidatorModule.ts
import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import BaseContractsModule from "./BaseContractsModule";
// Remove the ethers import if it's not used elsewhere in this specific file's top level
// import { ethers } from "ethers";

const ZKPValidatorModule = buildModule("ZKPValidatorModule", (m) => {
  const { eas, schemaRegistry, verifier } = m.useModule(BaseContractsModule);

  const answerSchemaUID_Param = m.getParameter<string>(
      "answerStatementSchemaUID",
      // --- Use the literal hex string for bytes32(0) ---
      "0x0000000000000000000000000000000000000000000000000000000000000000"
  );

  const zkpValidator = m.contract("ZKPValidator", [
    eas,
    schemaRegistry,
    verifier,
    answerSchemaUID_Param,
  ]);

  return {
    zkpValidator,
  };
});

export default ZKPValidatorModule;