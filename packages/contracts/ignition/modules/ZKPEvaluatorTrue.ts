import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Use a distinct name if needed, or reuse if overwriting is intended
const SimpleZKPTestModule = buildModule("SimpleZKPTestModule", (m) => {
  // Deploy the verifier using its FULLY QUALIFIED NAME
  const verifier = m.contract(
    "contracts/AlwaysTrueVerifier.sol:Groth16Verifier" // <--- CORRECTED with FQN
  );

  console.log("Deploying ZKPEvaluatorAggregator contract linked to AlwaysTrueVerifier...");
  // Deploy the Aggregator, PASSING THE AlwaysTrueVerifier's DEPLOYED ADDRESS
  const aggregator = m.contract("ZKPEvaluatorAggregator", [verifier]); // Pass verifier as constructor argument

  return { verifier, aggregator };
});

export default SimpleZKPTestModule; // Make sure to use the correct module name if changed