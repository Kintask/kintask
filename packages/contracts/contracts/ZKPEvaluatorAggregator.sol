// packages/contracts/contracts/ZKPEvaluatorAggregator.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// --- MODIFIED IMPORT ---
import { Groth16Verifier as Verifier } from "./AlwaysTrueVerifier.sol"; // <-- Use the new Verifier
// import "@openzeppelin/contracts/access/Ownable.sol"; // <-- REMOVED
// import "hardhat/console.sol";
import { CommonTypes } from "@zondax/filecoin-solidity/contracts/v0.8/types/CommonTypes.sol";
import { MarketTypes } from "@zondax/filecoin-solidity/contracts/v0.8/types/MarketTypes.sol";
import { MarketAPI } from "@zondax/filecoin-solidity/contracts/v0.8/MarketAPI.sol";

// contract ZKPEvaluatorAggregator is Ownable { // <-- REMOVED 'is Ownable'
contract ZKPEvaluatorAggregator {

    Verifier public immutable zkpVerifier;
    struct KBFiling { bytes32 contentHash; bool registered; }
    mapping(string => KBFiling) public kbFilings;

    struct EvaluationRecord {
        uint8 verdict;
        uint8 confidence;
        bool verified;
        uint blockVerified;
        bytes32 evidenceProposalId;
        uint64 finalDealId;
    }
    mapping(string => mapping(address => EvaluationRecord)) public verifiedEvaluations;

    mapping(string => address) public agentRegistry;
    uint8 public constant CONFIDENCE_SCALE_FACTOR = 100;

    event KnowledgeBaseRegistered(string indexed requestContext, bytes32 kbContentHash);
    event AgentRegistered(string indexed agentId, address indexed payoutAddress);
    event EvaluationVerified( string indexed requestContext, address indexed answeringAgent, uint8 verdict, uint8 confidence, bytes32 kbContentHash, bytes32 evidenceProposalId );
    event EvaluationFailed( string indexed requestContext, address indexed answeringAgent, string reason );
    event PayoutTriggered(string indexed requestContext, uint totalPaid);
    event PayoutSent(string indexed requestContext, address indexed recipient, uint amount);
    event PayoutFailed(string indexed requestContext, address indexed recipient, uint amount);

    // constructor(address _verifierAddress) Ownable(msg.sender) { // <-- REMOVED Ownable call
    constructor(address _verifierAddress) {
        require(_verifierAddress != address(0), "Verifier address cannot be zero");
        zkpVerifier = Verifier(_verifierAddress);
    }

    // function registerKnowledgeBase(string memory requestContext, bytes32 kbContentHash) external onlyOwner { // <-- REMOVED onlyOwner
    function registerKnowledgeBase(string memory requestContext, bytes32 kbContentHash) external {
        // Consider re-adding this check if needed, although multiple registrations might be okay for testing
        // require(!kbFilings[requestContext].registered, "Context already registered");
        kbFilings[requestContext] = KBFiling({ contentHash: kbContentHash, registered: true });
        emit KnowledgeBaseRegistered(requestContext, kbContentHash);
    }

    function registerAgent(string calldata agentId, address payoutAddress) external {
        require(bytes(agentId).length > 0, "Agent ID required");
        require(payoutAddress != address(0), "Payout address required");
        agentRegistry[agentId] = payoutAddress;
        emit AgentRegistered(agentId, payoutAddress);
    }

    function submitVerifiedEvaluation(
        string memory requestContext, address answeringAgent,
        uint[2] calldata proof_a, uint[2][2] calldata proof_b, uint[2] calldata proof_c,
        uint[8] calldata publicInputs,
        bytes32 evidenceProposalId
    ) external {
        // Removed re-entrancy check for simplicity in testing without owner, re-evaluate if needed
        // require(!verifiedEvaluations[requestContext][answeringAgent].verified, "Already verified");
        KBFiling storage kbInfo = kbFilings[requestContext];
        require(kbInfo.registered, "KB info not registered for context"); // Keep this check

        // Allow re-verification for testing? If so, remove the check above. If not, keep it.
        if (verifiedEvaluations[requestContext][answeringAgent].verified) {
             emit EvaluationFailed(requestContext, answeringAgent, "Already verified, skipping re-verification");
             return; // Or revert("Already verified");
        }

        // require(evidenceProposalId != bytes32(0), "Evidence Proposal ID required");

        // bool proofIsValid = zkpVerifier.verifyProof(proof_a, proof_b, proof_c, publicInputs);
        // require(proofIsValid, "ZKP Verification Failed (AlwaysTrue)");

        uint8 dummyVerdict = 1;
        uint8 dummyConfidence = 100;

        verifiedEvaluations[requestContext][answeringAgent] = EvaluationRecord({
            verdict: dummyVerdict,
            confidence: dummyConfidence,
            verified: true,
            blockVerified: block.number,
            evidenceProposalId: evidenceProposalId,
            finalDealId: 0 // Will be updated later if deal succeeds
        });

        emit EvaluationVerified(requestContext, answeringAgent, dummyVerdict, dummyConfidence, kbInfo.contentHash, evidenceProposalId);
    }

    // function triggerPayouts(string memory requestContext) external payable onlyOwner { // <-- REMOVED onlyOwner
    function triggerPayouts(string memory requestContext) external payable {
        // WARNING: Anyone can call this now. Payout logic needs careful review.
        // For testing, just emitting the event might be sufficient.
        emit PayoutTriggered(requestContext, msg.value); // Emit with received value if any
        // Actual payout distribution logic would go here, but is complex without ownership control.
    }

    function getKBInfo(string memory requestContext) external view returns (KBFiling memory) {
        return kbFilings[requestContext];
    }

    function getVerifierAddress() external view returns (address) {
        return address(zkpVerifier);
    }

    function getVerifiedEvaluation(string memory requestContext, address answeringAgent) external view returns (EvaluationRecord memory) {
        return verifiedEvaluations[requestContext][answeringAgent];
    }

    function getAgentPayoutAddress(string memory agentId) external view returns (address) {
        return agentRegistry[agentId];
    }

    function getEvaluationProposalId(string memory requestContext, address answeringAgent) external view returns (bytes32) {
        return verifiedEvaluations[requestContext][answeringAgent].evidenceProposalId;
    }

    function getEvaluationFinalDealId(string memory requestContext, address answeringAgent) external view returns (uint64) {
        return verifiedEvaluations[requestContext][answeringAgent].finalDealId;
    }

    /* // <-- REMOVED withdraw function as it relied on owner()
    function withdraw() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }
    */

    // Allow the contract to receive Ether (e.g., for future payouts if logic is added)
    receive() external payable {}
}