import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
// import hre from "hardhat"; // Keep commented unless needed for artifacts

// This module deploys Verifier and ZKPEvaluatorAggregator ONLY

const ZKPEvaluatorModule = buildModule("ZKPEvaluatorModule", (m) => {

  // 1. Deploy the Verifier contract
  console.log("Deploying Groth16Verifier...");
  const verifier = m.contract("Groth16Verifier");

  // 2. Deploy the ZKPEvaluatorAggregator, passing the Verifier's address
  console.log("Deploying ZKPEvaluatorAggregator contract...");
  const zkpAggregator = m.contract("ZKPEvaluatorAggregator", [verifier]);

  // Log deployed addresses using console.log AFTER deployment if needed,
  // or rely on Ignition's output. m.log is not a standard method here.
  // console.log(`Groth16Verifier deployed to: ${verifier.address}`); // Can't access address during build phase
  // console.log(`ZKPEvaluatorAggregator deployed to: ${zkpAggregator.address}`);

  return { verifier, zkpAggregator };
});

export default ZKPEvaluatorModule;
