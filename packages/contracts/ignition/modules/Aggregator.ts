// packages/contracts/ignition/modules/Aggregator.ts
import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const AggregatorModule = buildModule("AggregatorModule", (m) => {
  console.log("Ignition Module: Deploying Aggregator contract...");

  // Constructor takes no arguments
  const aggregator = m.contract("Aggregator", [], {
    id: "AggregatorContract", // Unique ID for this deployment instance
  });

  console.log("Ignition Module: Aggregator deployment configured.");

  // Return the deployed contract instance so Ignition reports its address
  return { aggregator };
});

export default AggregatorModule;