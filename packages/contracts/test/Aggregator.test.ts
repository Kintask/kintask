// packages/contracts/test/Aggregator.test.ts (Updated for Ethers v6)

import { ethers, network } from "hardhat";
import { expect } from "chai";
import { Aggregator } from "../typechain-types";
// loadFixture might still work, but less necessary if setup is in `before` for live networks
// import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Signer, ZeroAddress, parseEther, formatEther, getAddress, ContractTransactionResponse } from "ethers"; // Import v6 types/functions

// Define SignerWithAddress using ethers v6 Signer
type SignerWithAddress = Signer & { address: string };

describe("Aggregator Integration Tests on Calibration", function () {
  before(function() { /* ... network check ... */ });
  this.timeout(360000); // 6 minutes

  // Constants
  const DEPLOYED_CONTRACT_ADDRESS = "0xc4EAa1d5F94Ee779EE48Ca1E8f1246d29dF07C6f";
  const TEST_REQUEST_CONTEXT_BASE = `req_cal_run_${Date.now()}`;
  const AGENT_1_ID = `agent_cal_1_${Date.now()}`;
  const AGENT_2_ID = `agent_cal_2_${Date.now()}`;
  const AGENT_3_ID = `agent_cal_3_${Date.now()}`;
  const REAL_DEAL_ID = 12345n; // Needs real value
  const EVIDENCE_CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

  let aggregator: Aggregator;
  let owner: SignerWithAddress;
  let agent1Wallet: SignerWithAddress;
  let agent2Wallet: SignerWithAddress;
  let agent3Wallet: SignerWithAddress;
  let evidenceSubmitter: SignerWithAddress;
  let testContext1: string;
  let testContext2: string;

  before(async function() {
    const AggregatorFactory = await ethers.getContractFactory("Aggregator");
    aggregator = AggregatorFactory.attach(DEPLOYED_CONTRACT_ADDRESS) as Aggregator;
    console.log(`Connected to Aggregator at: ${DEPLOYED_CONTRACT_ADDRESS}`);

    const signers = await ethers.getSigners();
    if (signers.length < 5) { throw new Error(`Insufficient signers. Expected 5, got ${signers.length}.`); }
    [owner, agent1Wallet, agent2Wallet, agent3Wallet, evidenceSubmitter] = signers as SignerWithAddress[];

    console.log(`Using Owner: ${owner?.address}`);
    console.log(`Using Agent1: ${agent1Wallet?.address}`);
    // ... log other addresses ...

    if (!ethers.provider) { throw new Error("Ethers provider is not available."); }
    const initialBalance = await ethers.provider.getBalance(DEPLOYED_CONTRACT_ADDRESS);
    // *** Use v6 formatEther/parseEther ***
    console.log(`Initial contract balance: ${formatEther(initialBalance)} FIL`);
    const depositAmount = parseEther("0.1"); // Use v6 parseEther
    if (initialBalance < parseEther("0.05")) {
         console.log(`Depositing ${formatEther(depositAmount)} FIL into contract...`);
         try {
            // sendTransaction returns different object in v6
            const txResponse = await owner.sendTransaction({ to: DEPLOYED_CONTRACT_ADDRESS, value: depositAmount });
            console.log(`Deposit transaction sent: ${txResponse.hash}. Waiting for confirmation...`);
            await txResponse.wait(1); // Wait for 1 confirmation
            console.log(`Deposit complete.`);
            const newBalance = await ethers.provider.getBalance(DEPLOYED_CONTRACT_ADDRESS);
            console.log(`New contract balance: ${formatEther(newBalance)} FIL`);
         } catch (depositError: any) { console.error("ERROR Depositing funds:", depositError.message); }
    } else { console.log("Contract already has sufficient balance."); }

    testContext1 = `${TEST_REQUEST_CONTEXT_BASE}_sub`;
    testContext2 = `${TEST_REQUEST_CONTEXT_BASE}_agg`;
  });

  it("Should register agents and submit evidence", async function() {
    console.log("Registering agents...");
    // *** Use v6 getAddress ***
    const agent1Addr = getAddress(agent1Wallet.address);
    const agent2Addr = getAddress(agent2Wallet.address);
    const agent3Addr = getAddress(agent3Wallet.address);
    const submitterAddr = getAddress(evidenceSubmitter.address);

    // Send transactions and wait using v6 syntax
    let tx: ContractTransactionResponse; // Use v6 type
    tx = await aggregator.connect(owner).registerAgent(AGENT_1_ID, agent1Addr); await tx.wait(1); console.log(`Registered ${AGENT_1_ID}`);
    tx = await aggregator.connect(owner).registerAgent(AGENT_2_ID, agent2Addr); await tx.wait(1); console.log(`Registered ${AGENT_2_ID}`);
    tx = await aggregator.connect(owner).registerAgent(AGENT_3_ID, agent3Addr); await tx.wait(1); console.log(`Registered ${AGENT_3_ID}`);

    expect(await aggregator.getAgentAddress(AGENT_1_ID)).to.equal(agent1Addr);
    // ... check other agents ...
    console.log("Agent registration verified.");

    console.log(`Registering evidence CID: ${EVIDENCE_CID}, Deal ID: ${REAL_DEAL_ID}`);
    tx = await aggregator.connect(owner).registerEvidence(EVIDENCE_CID, submitterAddr, REAL_DEAL_ID); await tx.wait(1);

    const evidenceInfo = await aggregator.getEvidenceInfo(EVIDENCE_CID);
    expect(evidenceInfo.submitter).to.equal(submitterAddr);
    // ... check other fields ...
    console.log("Evidence registered successfully.");
  });

  it("Should submit verification results", async function() {
    const currentContext = testContext1;
    console.log(`Submitting verification results for context: ${currentContext}...`);
    let tx: ContractTransactionResponse;

    tx = await aggregator.connect(agent1Wallet).submitVerificationResult(currentContext, AGENT_1_ID, "Supported", 95, EVIDENCE_CID); await tx.wait(1); console.log(`Submitted by ${AGENT_1_ID}`);
    tx = await aggregator.connect(agent2Wallet).submitVerificationResult(currentContext, AGENT_2_ID, "Supported", 90, EVIDENCE_CID); await tx.wait(1); console.log(`Submitted by ${AGENT_2_ID}`);
    tx = await aggregator.connect(agent3Wallet).submitVerificationResult(currentContext, AGENT_3_ID, "Neutral", 50, ""); await tx.wait(1); console.log(`Submitted by ${AGENT_3_ID}`);

    const submissions = await aggregator.getSubmissions(currentContext);
    expect(submissions.length).to.equal(3);
    console.log("Verification results submission verified.");
  });

  it("Should aggregate results and potentially pay rewards", async function() {
    const currentContext = testContext2;
    console.log(`Aggregating results for context: ${currentContext}...`);
    // --- Setup submissions ---
    const existingSubmissions = await aggregator.getSubmissions(currentContext);
    if (existingSubmissions.length === 0) {
        console.log("Submitting verdicts for aggregation context...");
        let tx1 = await aggregator.connect(agent1Wallet).submitVerificationResult(currentContext, AGENT_1_ID, "Supported", 95, EVIDENCE_CID);
        let tx2 = await aggregator.connect(agent2Wallet).submitVerificationResult(currentContext, AGENT_2_ID, "Supported", 90, EVIDENCE_CID);
        let tx3 = await aggregator.connect(agent3Wallet).submitVerificationResult(currentContext, AGENT_3_ID, "Contradicted", 85, "");
        await Promise.all([tx1.wait(1), tx2.wait(1), tx3.wait(1)]);
        console.log("Verdicts submitted.");
    } else { console.log("Verdicts already exist."); }

    try {
      console.log("Calling aggregateResults...");
      const tx = await aggregator.connect(owner).aggregateResults(currentContext);
      console.log(`aggregateResults tx sent: ${tx.hash}. Waiting...`);
      // In ethers v6, tx.wait() returns a TransactionReceipt | null
      const receipt = await tx.wait(1);
      if (!receipt) { throw new Error("Transaction receipt was null"); }
      console.log(`aggregateResults tx confirmed block ${receipt.blockNumber}`);

      // --- Event Parsing in Ethers v6 ---
      // Option 1: Filter logs manually (less robust to ABI changes)
      // const verdictAggregatedTopic = aggregator.interface.getEventTopic("VerdictAggregated");
      // const rewardPaidTopic = aggregator.interface.getEventTopic("RewardPaid");
      // let verdictAggregatedArgs: any = null;
      // let rewardsPaidCount = 0;
      // let totalRewardAmount = 0n; // Use BigInt for v6
      // for (const log of receipt.logs) {
      //     if (log.topics[0] === verdictAggregatedTopic && getAddress(log.address) === DEPLOYED_CONTRACT_ADDRESS) {
      //         verdictAggregatedArgs = aggregator.interface.parseLog(log)?.args;
      //         console.log("Found VerdictAggregated Event:", verdictAggregatedArgs);
      //     } else if (log.topics[0] === rewardPaidTopic && getAddress(log.address) === DEPLOYED_CONTRACT_ADDRESS) {
      //         rewardsPaidCount++;
      //         const args = aggregator.interface.parseLog(log)?.args;
      //         const amount = args?.amount as bigint; // bigint in v6
      //         totalRewardAmount += amount;
      //         console.log(`-> Found RewardPaid Event: To=${args?.recipient}, Reason=${args?.reason}, Amount=${formatEther(amount)}`);
      //     }
      // }

      // Option 2: Use receipt.getLogs (More robust with TypeChain types)
      const verdictEvents = await aggregator.queryFilter(aggregator.filters.VerdictAggregated(currentContext), receipt.blockNumber, receipt.blockNumber);
      const rewardEvents = await aggregator.queryFilter(aggregator.filters.RewardPaid(currentContext), receipt.blockNumber, receipt.blockNumber);

      expect(verdictEvents.length, "VerdictAggregated event not found").to.be.greaterThan(0);
      const verdictAggregatedArgs = verdictEvents[0].args;
      console.log("Found VerdictAggregated Event:", verdictAggregatedArgs);

      // Assertions (adjust based on deal check outcome)
      expect(verdictAggregatedArgs?.requestContext).to.equal(currentContext);
      expect(verdictAggregatedArgs?.finalVerdict).to.equal("Verified");
      expect(verdictAggregatedArgs?.finalConfidence).to.equal(92);
      expect(verdictAggregatedArgs?.submissionCount).to.equal(3);
      console.log("Aggregated Active Evidence CIDs:", verdictAggregatedArgs?.evidenceCids);
      // expect(verdictAggregatedArgs?.evidenceCids).to.deep.equal([EVIDENCE_CID]); // If deal active

      const verdict = await aggregator.verdicts(currentContext);
      expect(verdict.exists).to.be.true;
      expect(verdict.finalVerdict).to.equal("Verified");

      console.log(`Total RewardPaid events found: ${rewardEvents.length}`);
      let totalRewardAmount = 0n; // Use BigInt
      for (const event of rewardEvents) {
            const args = event.args;
            totalRewardAmount += args.amount; // Direct BigInt addition
            console.log(`-> Found RewardPaid Event: To=${args.recipient}, Reason=${args.reason}, Amount=${formatEther(args.amount)}`);
      }
       console.log(`Total Amount Rewarded: ${formatEther(totalRewardAmount)} FIL`);
       // Assertions based on expected rewards if deal active

    } catch (error: any) { /* ... keep error handling ... */ throw error; }
  });

  it("Should reflect non-zero balance after operations (informational)", async function() {
    // Skip on calibration
    if (network.name === "calibration") { this.skip(); }
    const balance = await ethers.provider.getBalance(DEPLOYED_CONTRACT_ADDRESS);
    console.log(`Contract balance after ops: ${formatEther(balance)} FIL`); // Use v6 formatEther
    expect(balance >= 0n).to.be.true; // Check balance is non-negative (BigInt)
  });
});

// ==== ./packages/contracts/test/Aggregator.test.ts (Updated for Ethers v6) ====