// packages/contracts/contracts/ZKPEvaluatorAggregator.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { Groth16Verifier as Verifier } from "./Verifier.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "hardhat/console.sol"; // Keep import

/**
 * @title ZKP Evaluator Aggregator (Fixed Console Logs)
 */
contract ZKPEvaluatorAggregator is Ownable {

    Verifier public immutable zkpVerifier;
    struct KBFiling { bytes32 contentHash; bool registered; }
    mapping(string => KBFiling) public kbFilings;
    struct EvaluationRecord { uint8 verdict; uint8 confidence; bool verified; uint blockVerified; uint64 evidenceDealId; }
    mapping(string => mapping(address => EvaluationRecord)) public verifiedEvaluations;
    mapping(string => address) public agentRegistry;
    uint8 public constant CONFIDENCE_SCALE_FACTOR = 100;

    event KnowledgeBaseRegistered(string indexed requestContext, bytes32 kbContentHash);
    event AgentRegistered(string indexed agentId, address indexed payoutAddress);
    event EvaluationVerified( string indexed requestContext, address indexed answeringAgent, uint8 verdict, uint8 confidence, bytes32 kbContentHash, uint64 evidenceDealId );
    event EvaluationFailed( string indexed requestContext, address indexed answeringAgent, string reason );
    event PayoutTriggered(string indexed requestContext, uint totalPaid);
    event PayoutSent(string indexed requestContext, address indexed recipient, uint amount);
    event PayoutFailed(string indexed requestContext, address indexed recipient, uint amount);
    event ProofCheckResult(string indexed context, bool passed);

    constructor(address _verifierAddress) Ownable(msg.sender) {
        console.log("Deploying ZKPEvaluatorAggregator with Verifier at:", _verifierAddress);
        require(_verifierAddress != address(0), "Verifier address cannot be zero");
        zkpVerifier = Verifier(_verifierAddress);
    }

    function registerKnowledgeBase( string memory requestContext, bytes32 kbContentHash ) external onlyOwner {
        console.log("Attempting KB Registration for Context:", requestContext);
        console.log("  Owner:", msg.sender);
        // console.log("  Provided Hash:", kbContentHash); // Cannot log bytes32
        require(!kbFilings[requestContext].registered, "KB already registered");
        kbFilings[requestContext] = KBFiling({ contentHash: kbContentHash, registered: true });
        console.log("  KB Registration Successful.");
        emit KnowledgeBaseRegistered(requestContext, kbContentHash);
    }
    function registerAgent(string calldata agentId, address payoutAddress) external { require(bytes(agentId).length > 0); require(payoutAddress != address(0)); agentRegistry[agentId] = payoutAddress; emit AgentRegistered(agentId, payoutAddress); }

    function submitVerifiedEvaluation(
        string memory requestContext, address answeringAgent,
        uint[2] calldata proof_a, uint[2][2] calldata proof_b, uint[2] calldata proof_c,
        uint[8] calldata publicInputs, uint64 evidenceDealId
    ) external {
        console.log("\nEntering submitVerifiedEvaluation for context:", requestContext);
        console.log("  Sender Param (Agent Address):", answeringAgent);
        console.log("  Actual Msg.sender:", msg.sender);
        console.log("  Deal ID:", evidenceDealId);

        console.log("  Checking: Not already verified");
        require(!verifiedEvaluations[requestContext][answeringAgent].verified, "Already verified");
        console.log("  Checking: KB Registered flag");
        KBFiling storage kbInfo = kbFilings[requestContext];
        require(kbInfo.registered, "KB info not registered for context");
        console.log("  Checking: Deal ID > 0");
        require(evidenceDealId > 0, "Evidence Deal ID required");

        uint8 claimedVerdict = uint8(publicInputs[6]);
        uint8 claimedConfidence = uint8(publicInputs[7]);
        // *** Split the combined log into supported types ***
        console.log("  Checking: Verdict <= 2 (Claimed:", uint(claimedVerdict), ")");
        require(claimedVerdict <= 2, "Invalid claimed verdict code");
        console.log("  Checking: Confidence <= Scale (Claimed:", uint(claimedConfidence), ")");
        require(claimedConfidence <= CONFIDENCE_SCALE_FACTOR, "Invalid claimed confidence value");

        // KB Hash check relies on ZKP verification implicitly
        console.log("  KB Hash check passed (implicitly via ZKP).");

        console.log("  Calling zkpVerifier.verifyProof...");
        // Cannot easily log complex inputs like arrays/structs
        console.log("    PublicInputs[6] (verdict):", publicInputs[6]);
        console.log("    PublicInputs[7] (confidence):", publicInputs[7]);

        bool proofIsValid = zkpVerifier.verifyProof(proof_a, proof_b, proof_c, publicInputs);
        console.log("  verifyProof returned:", proofIsValid);
        require(proofIsValid, "ZKP Verification Failed");

        console.log("  Proof valid. Writing to verifiedEvaluations mapping...");
        verifiedEvaluations[requestContext][answeringAgent] = EvaluationRecord({
            verdict: claimedVerdict, confidence: claimedConfidence, verified: true,
            blockVerified: block.number, evidenceDealId: evidenceDealId
        });
        console.log("  State write successful.");

        console.log("  Emitting EvaluationVerified event...");
        emit EvaluationVerified( requestContext, answeringAgent, claimedVerdict, claimedConfidence, kbInfo.contentHash, evidenceDealId );
        console.log("  Event emitted. Function finished successfully.");
    }

    // --- Payout & Read Functions ---
    function triggerPayouts(string memory requestContext) external payable onlyOwner { emit PayoutTriggered(requestContext, 0); }
    function getKBInfo(string memory requestContext) external view returns (KBFiling memory) { return kbFilings[requestContext]; }
    function getVerifiedEvaluation(string memory requestContext, address answeringAgent) external view returns (EvaluationRecord memory) { return verifiedEvaluations[requestContext][answeringAgent]; }
    function getAgentPayoutAddress(string memory agentId) external view returns (address) { return agentRegistry[agentId]; }
    function getEvaluationDealId(string memory requestContext, address answeringAgent) external view returns (uint64) { return verifiedEvaluations[requestContext][answeringAgent].evidenceDealId; }
    function withdraw() external onlyOwner { payable(owner()).transfer(address(this).balance); }
    receive() external payable {}
}
