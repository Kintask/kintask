// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// Import the generated ZKP Verifier interface/contract
import { Groth16Verifier as Verifier } from "./Verifier.sol";

// Import Zondax Filecoin library components
import { CommonTypes } from "@zondax/filecoin-solidity/contracts/v0.8/types/CommonTypes.sol";
import { MarketTypes } from "@zondax/filecoin-solidity/contracts/v0.8/types/MarketTypes.sol";
import { MarketAPI } from "@zondax/filecoin-solidity/contracts/v0.8/MarketAPI.sol";
import { FilAddresses } from "@zondax/filecoin-solidity/contracts/v0.8/utils/FilAddresses.sol";

// Import Ownable for access control
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ZKP Evaluator Aggregator
 * @notice Verifies ZKPs of off-chain evaluations and checks Filecoin deal status.
 */
contract ZKPEvaluatorAggregator is Ownable {

    // --- Events ---
    event KnowledgeBaseRegistered(string indexed requestContext, string kbCid, uint64 kbDealId);
    event AgentRegistered(string indexed agentId, address indexed payoutAddress);
    event EvaluationVerified(
        string indexed requestContext,
        address indexed answeringAgent,
        uint8 verdict,
        uint8 confidence,
        uint64 kbDealIdChecked,
        bytes32 kbContentHash
    );
    event EvaluationFailed(
        string indexed requestContext,
        address indexed answeringAgent,
        string reason
    );
    event PayoutTriggered(string indexed requestContext, uint totalPaid);
    event PayoutSent(string indexed requestContext, address indexed recipient, uint amount);
    event PayoutFailed(string indexed requestContext, address indexed recipient, uint amount);

    // --- State Variables ---
    Verifier public immutable zkpVerifier;

    struct KBFiling {
        string cid;
        bytes32 contentHash; // Hash matching ZKP public input
        uint64 dealId;
        bool registered;
    }
    mapping(string => KBFiling) public kbFilings;

    struct EvaluationRecord {
        uint8 verdict;    // 0=Incorrect, 1=Correct, 2=Uncertain
        uint8 confidence; // 0-100
        bool verified;
        uint blockVerified;
    }
    mapping(string => mapping(address => EvaluationRecord)) public verifiedEvaluations;

    mapping(string => address) public agentRegistry;
    uint8 public constant CONFIDENCE_SCALE_FACTOR = 100;

    // --- Constructor ---
    constructor(address _verifierAddress) Ownable(msg.sender) {
        require(_verifierAddress != address(0), "Verifier address cannot be zero");
        zkpVerifier = Verifier(_verifierAddress);
    }

    // --- Registration Functions ---
    function registerKnowledgeBase(
        string memory requestContext,
        string memory kbCid,
        bytes32 kbContentHash,
        uint64 kbDealId
    ) external onlyOwner {
        require(bytes(requestContext).length > 0, "Context empty");
        require(bytes(kbCid).length > 0, "CID empty");
        require(kbDealId > 0, "Deal ID invalid");
        require(!kbFilings[requestContext].registered, "KB already registered");

        kbFilings[requestContext] = KBFiling({
            cid: kbCid,
            contentHash: kbContentHash,
            dealId: kbDealId,
            registered: true
        });
        emit KnowledgeBaseRegistered(requestContext, kbCid, kbDealId);
    }

    function registerAgent(string calldata agentId, address payoutAddress) external {
        require(bytes(agentId).length > 0, "Agent ID empty");
        require(payoutAddress != address(0), "Payout address zero");
        agentRegistry[agentId] = payoutAddress;
        emit AgentRegistered(agentId, payoutAddress);
    }

    // --- Core Verification Function ---
    function submitVerifiedEvaluation(
        string memory requestContext,
        address answeringAgent,
        uint[2] calldata proof_a,
        uint[2][2] calldata proof_b,
        uint[2] calldata proof_c,
        uint[8] calldata publicInputs // Expected: [reqCtxHash, kbHash, qHash, ansHash, llmResHash, agentId, verdict, confidence]
    ) external {
        require(bytes(requestContext).length > 0, "Context required");
        require(answeringAgent != address(0), "Invalid agent");
        require(!verifiedEvaluations[requestContext][answeringAgent].verified, "Already verified");

        KBFiling storage kbInfo = kbFilings[requestContext];
        require(kbInfo.registered, "KB not registered");

        bytes32 providedKbContentHash = bytes32(publicInputs[1]); // Index 1
        uint8 providedVerdict = uint8(publicInputs[6]);         // Index 6
        uint8 providedConfidence = uint8(publicInputs[7]);        // Index 7

        // VERIFY 1: Input Consistency
        require(providedKbContentHash == kbInfo.contentHash, "ZKP Input: KB hash mismatch");
        // Optional: Check agent ID - require(uint(uint160(answeringAgent)) == publicInputs[5], "ZKP Input: Agent ID mismatch");

        // VERIFY 2: Storage Proof (FVM Native)
        MarketTypes.GetDealActivationReturn memory activationInfo = MarketAPI.getDealActivation(kbInfo.dealId);
        bool isDealActive = CommonTypes.ChainEpoch.unwrap(activationInfo.activated) > -1 &&
                            CommonTypes.ChainEpoch.unwrap(activationInfo.terminated) == -1;
        if (!isDealActive) {
            emit EvaluationFailed(requestContext, answeringAgent, "Storage Deal: KB not active");
            return; // Fail softly
        }

        // VERIFY 3: ZKP Computation Proof
        bool proofIsValid = zkpVerifier.verifyProof(proof_a, proof_b, proof_c, publicInputs);
        if (!proofIsValid) {
             emit EvaluationFailed(requestContext, answeringAgent, "ZKP Verification Failed");
             return; // Fail softly
        }

        // ALL VERIFICATIONS PASSED
        require(providedVerdict <= 2, "Invalid verdict code");
        require(providedConfidence <= CONFIDENCE_SCALE_FACTOR, "Invalid confidence value");

        verifiedEvaluations[requestContext][answeringAgent] = EvaluationRecord({
            verdict: providedVerdict,
            confidence: providedConfidence,
            verified: true,
            blockVerified: block.number
        });
        emit EvaluationVerified(requestContext, answeringAgent, providedVerdict, providedConfidence, kbInfo.dealId, providedKbContentHash);
    }

    // --- Payout Function (Placeholder) ---
    function triggerPayouts(string memory requestContext) external payable onlyOwner {
        // TODO: Implement payout logic based on verifiedEvaluations
        emit PayoutTriggered(requestContext, 0);
    }

    // --- Read Functions ---
    function getKBInfo(string memory requestContext) external view returns (KBFiling memory) { return kbFilings[requestContext]; }
    function getVerifiedEvaluation(string memory requestContext, address answeringAgent) external view returns (EvaluationRecord memory) { return verifiedEvaluations[requestContext][answeringAgent]; }
    function getAgentPayoutAddress(string memory agentId) external view returns (address) { return agentRegistry[agentId]; }

    // --- Fund Management ---
    function withdraw() external onlyOwner { payable(owner()).transfer(address(this).balance); }
    receive() external payable {}
}