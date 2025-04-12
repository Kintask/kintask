// import { task } from "hardhat/config";
// // Use require for ABI if import causes issues in tasks
// const ZKPEvaluatorAggregatorAbi = require("../artifacts/contracts/ZKPEvaluatorAggregator.sol/ZKPEvaluatorAggregator.json").abi;

// task("register-kb", "Registers KB info on ZKPEvaluatorAggregator contract")
//   .addParam("contract", "Address of the deployed ZKPEvaluatorAggregator contract")
//   .addParam("context", "The request context string")
//   .addParam("cid", "The Data CID of the KB file")
//   .addParam("hash", "The Keccak256 hash (bytes32 hex) of the KB file content")
//   .addParam("dealid", "The ACTIVE Filecoin Deal ID storing the KB file")
//   .setAction(async (taskArgs, hre) => {
//     const [signer] = await hre.ethers.getSigners(); // Use hre.ethers
//     console.log(`Using signer: ${signer.address}`);
//     console.log(`Registering KB on contract: ${taskArgs.contract}`);

//     const contract = new hre.ethers.Contract(
//         taskArgs.contract,
//         ZKPEvaluatorAggregatorAbi, // Use loaded ABI
//         signer
//     );

//     const requestContext = taskArgs.context;
//     const kbCid = taskArgs.cid;
//     const kbContentHash = taskArgs.hash; // Should be "0x..."
//     const kbDealId = hre.ethers.toBigInt(taskArgs.dealid); // Use hre.ethers (v6 style)

//     // Basic validation
//     if (!hre.ethers.isHexString(kbContentHash, 32)) {
//         console.error(`ERROR: Invalid hash format: ${kbContentHash}. Must be a 32-byte hex string (0x...).`);
//         return;
//     }
//     if (kbDealId <= 0) { // BigInt comparison
//         console.error(`ERROR: Invalid Deal ID: ${taskArgs.dealid}. Must be positive.`);
//         return;
//     }

//     console.log(`  Context: ${requestContext}`);
//     console.log(`  CID: ${kbCid}`);
//     console.log(`  Hash: ${kbContentHash}`);
//     console.log(`  Deal ID: ${kbDealId.toString()}`);

//     try {
//       // Ensure Deal ID is passed as uint64 compatible type (BigInt should work)
//       const tx = await contract.registerKnowledgeBase(
//         requestContext,
//         kbCid,
//         kbContentHash,
//         kbDealId
//         // { gasLimit: 1500000 } // Optional gas limit override
//       );
//       console.log(`\nTransaction sent: ${tx.hash}`);
//       console.log("Waiting for 1 confirmation...");
//       const receipt = await tx.wait(1);
//       console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
//       console.log(`KB Registered successfully for context ${requestContext}!`);
//     } catch (error: any) {
//       console.error(`\nError registering KB: ${error.message}`);
//       // Log more details if available
//       if (error.reason) console.error(`  Revert Reason: ${error.reason}`);
//       if (error.data?.message) console.error(`  Error Data: ${error.data.message}`);
//     }
//   });

//   export {};
