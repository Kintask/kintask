import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import hre from "hardhat"; // Import the Hardhat Runtime Environment

// This module deploys the Groth16Verifier contract first, then the ZKPEvaluatorAggregator,
// passing the Verifier's address to the Aggregator's constructor.

const ZKPEvaluatorModule = buildModule("ZKPEvaluatorModule", (m) => {
  // --- Get Artifact using HRE ---
  // hre.artifacts.readArtifactSync requires the contract name as defined in the .sol file
  const verifierArtifact = hre.artifacts.readArtifactSync("Groth16Verifier");

  // Deploy the Verifier contract using the artifact obtained via HRE
  console.log("Deploying Groth16Verifier contract using HRE artifact...");
  // Pass the artifact object (containing abi and bytecode)
  // NOTE: The first argument to m.contract should ideally still match the contract name
  // for Ignition's internal tracking, even though we provide the artifact.
  const verifier = m.contract("Groth16Verifier", verifierArtifact);

  // Deploy the ZKPEvaluatorAggregator contract, passing the deployed Verifier address
  console.log("Deploying ZKPEvaluatorAggregator contract...");
  // Here we don't need the artifact explicitly if the name matches compilation output
  const zkpAggregator = m.contract("ZKPEvaluatorAggregator", [verifier]);

  console.log("Deployment module definition complete.");

  return { verifier, zkpAggregator };
});

export default ZKPEvaluatorModule;
