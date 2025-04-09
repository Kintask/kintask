// Aggregator.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// --- Import Zondax FEVM Library Components ---
import { CommonTypes } from "@zondax/filecoin-solidity/contracts/v0.8/types/CommonTypes.sol";
import { MarketTypes } from "@zondax/filecoin-solidity/contracts/v0.8/types/MarketTypes.sol";
import { MarketAPI } from "@zondax/filecoin-solidity/contracts/v0.8/MarketAPI.sol";

/**
 * @title Aggregator Contract
 * @notice Aggregates verification results from multiple agents, verifies associated evidence stored on Filecoin, and distributes rewards.
 * @dev Uses the Zondax Filecoin Solidity library to interact with the Market actor.
 * IMPORTANT: Ensure sufficient gas limits when calling aggregateResults, especially with many submissions or CIDs.
 * WARNING: The aggregateResults function WILL REVERT if ANY deal check via MarketAPI.getDealActivation fails (e.g., invalid deal ID).
 */
contract Aggregator {
    // --- State Variables ---

    address public owner;

    // Mapping: requestContext -> list of submissions for that context
    mapping(string => VerifierSubmission[]) public submissions;
    // Mapping: requestContext -> aggregated final verdict
    mapping(string => AggregatedVerdict) public verdicts;
    // Mapping: evidence CID -> information about the evidence
    mapping(string => EvidenceInfo) public evidenceRegistry;
    // Mapping: agentId (string) -> agent's payout address
    mapping(string => address) public agentRegistry;

    // --- Structs ---

    struct VerifierSubmission {
        string agentId;
        string verdict; // "Supported", "Contradicted", "Neutral"
        uint8 confidence; // 0-100
        string evidenceCid; // CID of supporting evidence, can be empty
    }

    struct AggregatedVerdict {
        string finalVerdict; // e.g., "Verified", "Flagged: Contradictory", "Uncertain"
        uint8 finalConfidence;
        string[] evidenceCids; // CIDs that were *active* and supported the consensus
        address aggregator; // Address that triggered the aggregation
        uint timestamp; // Block timestamp of aggregation
        uint submissionCount; // Number of submissions considered
        bool exists; // Flag to check if a verdict has been aggregated
    }

    struct EvidenceInfo {
        address submitter; // Address that registered the evidence
        uint64 dealId; // Filecoin Deal ID associated with the CID storage
        uint256 usageScore; // Tracks how often this evidence was used in a consensus
        bool exists; // Flag to check if evidence is registered
    }

    // --- Events ---

    event EvidenceRegistered(string indexed cid, address indexed submitter, uint64 indexed dealId);
    event AgentRegistered(string indexed agentId, address indexed payoutAddress);
    event VerdictSubmitted(string indexed requestContext, string agentId, string verdict, uint8 confidence, string evidenceCid);
    event VerdictAggregated(string indexed requestContext, string finalVerdict, uint8 finalConfidence, string[] evidenceCids, uint submissionCount);
    event RewardPaid(string indexed requestContext, address indexed recipient, string reason, string evidenceCid, uint256 amount);
    event RewardTransferFailed(address indexed recipient, st    ring reason, uint256 amount);
    event AggregationError(string indexed requestContext, string reason);
    event DealCheckResult(string indexed requestContext, string indexed cid, uint64 dealId, bool isActive, int64 activatedEpoch, int64 terminatedEpoch);

    // --- Modifiers ---

    modifier onlyOwner() {
        require(msg.sender == owner, "Aggregator: Caller is not the owner");
        _;
    }

    // --- Contract Lifecycle ---

    receive() external payable {}

    constructor() {
        owner = msg.sender;
    }

    // --- Fund Management ---

    function depositFunds() external payable onlyOwner {}

    function withdrawFunds(uint256 amount) external onlyOwner {
        require(amount <= address(this).balance, "Aggregator: Insufficient contract balance");
        (bool success, ) = owner.call{value: amount}("");
        require(success, "Aggregator: Withdrawal failed");
    }

    // --- Registration Functions ---

    function registerEvidence(string calldata cid, address submitter, uint64 dealId) external onlyOwner {
        require(bytes(cid).length > 0, "Aggregator: CID cannot be empty");
        require(submitter != address(0), "Aggregator: Submitter address cannot be zero");
        require(dealId != 0, "Aggregator: Deal ID cannot be zero");
        require(!evidenceRegistry[cid].exists, "Aggregator: Evidence CID already registered");

        evidenceRegistry[cid] = EvidenceInfo({
            submitter: submitter,
            dealId: dealId,
            usageScore: 0,
            exists: true
        });
        emit EvidenceRegistered(cid, submitter, dealId);
    }

    function registerAgent(string calldata agentId, address payoutAddress) external {
        require(bytes(agentId).length > 0, "Aggregator: Agent ID cannot be empty");
        require(payoutAddress != address(0), "Aggregator: Payout address cannot be zero");
        agentRegistry[agentId] = payoutAddress;
        emit AgentRegistered(agentId, payoutAddress);
    }

    // --- Core Logic ---

    function submitVerificationResult(
        string calldata requestContext,
        string calldata agentId,
        string calldata verdict,
        uint8 confidence,
        string calldata evidenceCid
    ) external {
        require(bytes(requestContext).length > 0, "Aggregator: Request context required");
        require(confidence <= 100, "Aggregator: Confidence must be between 0 and 100");
        require(
            keccak256(bytes(verdict)) == keccak256(bytes("Supported")) ||
            keccak256(bytes(verdict)) == keccak256(bytes("Contradicted")) ||
            keccak256(bytes(verdict)) == keccak256(bytes("Neutral")),
            "Aggregator: Invalid verdict string"
        );

        submissions[requestContext].push(VerifierSubmission({
            agentId: agentId,
            verdict: verdict,
            confidence: confidence,
            evidenceCid: evidenceCid
        }));
        emit VerdictSubmitted(requestContext, agentId, verdict, confidence, evidenceCid);
    }

    /**
     * @notice Aggregates submitted results for a given context, determines consensus, verifies evidence deals, and distributes rewards.
     * @param requestContext The identifier for the verification task to aggregate.
     * @dev Follows Checks-Effects-Interactions pattern to mitigate reentrancy.
     * @dev Gas cost can be significant depending on the number of submissions and CIDs. Consider limits or alternative patterns for large scale.
     * WARNING: This function WILL REVERT if ANY deal check via MarketAPI.getDealActivation fails (e.g., invalid deal ID).
     */
    function aggregateResults(string calldata requestContext) external {
        // --- Checks ---
        require(!verdicts[requestContext].exists, "Aggregator: Verdict already aggregated for this context");
        VerifierSubmission[] storage agentSubmissions = submissions[requestContext];
        uint numSubmissions = agentSubmissions.length;
        require(numSubmissions > 0, "Aggregator: No submissions found for this context");

        // --- Calculate Consensus ---
        (
            string memory consensusVerdictStr,
            uint8 consensusConfidence,
            bool requiresEvidenceCheck
        ) = _calculateConsensus(agentSubmissions, numSubmissions);

        // --- Collect Winners ---
        (
            string[] memory finalWinningAgentIds,
            string[] memory finalPotentialWinningCids
        ) = _collectPotentialWinners(agentSubmissions, numSubmissions, consensusVerdictStr, requiresEvidenceCheck);


        // --- Verify Deals & Filter CIDs ---
         string[] memory finalActiveEvidenceCids = _verifyDealsAndGetActiveCIDs(
             requestContext,
             finalPotentialWinningCids,
             requiresEvidenceCheck
         );

        // --- Distribute Rewards ---
        uint256 totalRewardPool = address(this).balance / 2; // Example: Use 50% of balance
        uint256 submitterRewardPool = totalRewardPool / 2; // Example: 25% for submitters
        uint256 agentRewardPool = totalRewardPool - submitterRewardPool; // Example: 25% for agents

        _distributeRewards(
            requestContext,
            finalActiveEvidenceCids,
            finalWinningAgentIds,
            submitterRewardPool,
            agentRewardPool
        );

        // --- Final State Update (Effect part 3) ---
        verdicts[requestContext] = AggregatedVerdict({
            finalVerdict: consensusVerdictStr,
            finalConfidence: consensusConfidence,
            evidenceCids: finalActiveEvidenceCids,
            aggregator: msg.sender,
            timestamp: block.timestamp,
            submissionCount: numSubmissions,
            exists: true
        });

        emit VerdictAggregated(requestContext, consensusVerdictStr, consensusConfidence, finalActiveEvidenceCids, numSubmissions);
    }


    // --- Internal Helper Functions for Refactoring ---

    /**
     * @dev Calculates the consensus verdict, confidence, and if evidence check is needed.
     */
    function _calculateConsensus(
        VerifierSubmission[] storage agentSubmissions,
        uint numSubmissions
    ) internal view returns (string memory consensusVerdictStr, uint8 consensusConfidence, bool requiresEvidenceCheck)
    {
        uint supportVotes = 0;
        uint contradictVotes = 0;
        uint supportConfidenceSum = 0;
        uint contradictConfidenceSum = 0;

        for (uint i = 0; i < numSubmissions; i++) {
            VerifierSubmission storage sub = agentSubmissions[i];
            if (keccak256(bytes(sub.verdict)) == keccak256(bytes("Supported"))) {
                supportVotes++;
                supportConfidenceSum += sub.confidence;
            } else if (keccak256(bytes(sub.verdict)) == keccak256(bytes("Contradicted"))) {
                contradictVotes++;
                contradictConfidenceSum += sub.confidence;
            }
        }

        uint requiredVotes = (numSubmissions / 2) + 1;

        if (supportVotes >= requiredVotes) {
            consensusVerdictStr = "Verified";
            if (supportVotes > 0) { consensusConfidence = uint8(supportConfidenceSum / supportVotes); }
            requiresEvidenceCheck = true;
        } else if (contradictVotes >= requiredVotes) {
            consensusVerdictStr = "Flagged: Contradictory";
            if (contradictVotes > 0) { consensusConfidence = uint8(contradictConfidenceSum / contradictVotes); }
             requiresEvidenceCheck = true;
        } else {
            consensusVerdictStr = "Uncertain";
            consensusConfidence = 0;
            requiresEvidenceCheck = false; // No evidence check needed if uncertain
        }

        return (consensusVerdictStr, consensusConfidence, requiresEvidenceCheck);
    }

    /**
     * @dev Collects winning agent IDs and potential winning CIDs based on the consensus.
     */
    function _collectPotentialWinners(
         VerifierSubmission[] storage agentSubmissions,
         uint numSubmissions,
         string memory consensusVerdictStr,
         bool requiresEvidenceCheck
     ) internal view returns (string[] memory finalWinningAgentIds, string[] memory finalPotentialWinningCids)
     {
        if (!requiresEvidenceCheck) {
            return (new string[](0), new string[](0));
        }

        string[] memory winningAgentIds = new string[](numSubmissions);
        uint winningAgentCount = 0;
        string[] memory potentialWinningCidsArray = new string[](numSubmissions);
        uint potentialWinningCidCount = 0;

        string memory requiredVerdict = "";
        if (keccak256(bytes(consensusVerdictStr)) == keccak256(bytes("Verified"))) {
            requiredVerdict = "Supported";
        } else if (keccak256(bytes(consensusVerdictStr)) == keccak256(bytes("Flagged: Contradictory"))) {
            requiredVerdict = "Contradicted";
        }

        if(bytes(requiredVerdict).length > 0) {
            bytes32 requiredVerdictHash = keccak256(bytes(requiredVerdict));
            for (uint i = 0; i < numSubmissions; i++) {
                if (keccak256(bytes(agentSubmissions[i].verdict)) == requiredVerdictHash) {
                    winningAgentIds[winningAgentCount++] = agentSubmissions[i].agentId;
                    string memory cid = agentSubmissions[i].evidenceCid;
                    if (bytes(cid).length > 0 && evidenceRegistry[cid].exists) {
                       potentialWinningCidsArray[potentialWinningCidCount++] = cid;
                    }
                }
            }
        }

        finalWinningAgentIds = new string[](winningAgentCount);
        for(uint i = 0; i < winningAgentCount; i++){ finalWinningAgentIds[i] = winningAgentIds[i]; }
        finalPotentialWinningCids = new string[](potentialWinningCidCount);
        for(uint i = 0; i < potentialWinningCidCount; i++){ finalPotentialWinningCids[i] = potentialWinningCidsArray[i]; }

        return (finalWinningAgentIds, finalPotentialWinningCids);
    }

     /**
      * @dev Verifies deals for potential CIDs and returns an array of unique, active CIDs.
      * WARNING: This internal function WILL REVERT if ANY MarketAPI call fails.
      */
    function _verifyDealsAndGetActiveCIDs(
        string memory requestContext,
        string[] memory potentialWinningCids,
        bool requiresEvidenceCheck
    ) internal returns (string[] memory finalActiveEvidenceCids)
    {
        uint potentialWinningCidCount = potentialWinningCids.length;
        if (!requiresEvidenceCheck || potentialWinningCidCount == 0) {
            return new string[](0);
        }

        string[] memory activeEvidenceCids = new string[](potentialWinningCidCount);
        uint activeEvidenceCount = 0;

        for (uint i = 0; i < potentialWinningCidCount; i++) {
            string memory cid = potentialWinningCids[i];
            EvidenceInfo storage evInfo = evidenceRegistry[cid]; // Assumed to exist

            if (evInfo.dealId > 0) {
                // --- Direct call - NO try/catch ---
                // WARNING: Reverts on failure
                MarketTypes.GetDealActivationReturn memory activationInfo = MarketAPI.getDealActivation(evInfo.dealId);
                int64 activatedEpoch = CommonTypes.ChainEpoch.unwrap(activationInfo.activated);
                int64 terminatedEpoch = CommonTypes.ChainEpoch.unwrap(activationInfo.terminated);
                bool dealActive = activatedEpoch > -1 && terminatedEpoch == -1;

                emit DealCheckResult(requestContext, cid, evInfo.dealId, dealActive, activatedEpoch, terminatedEpoch);
                // --- End MarketAPI call ---

                if (dealActive) {
                    bool alreadyAdded = false;
                    for (uint j = 0; j < activeEvidenceCount; j++) {
                        if (keccak256(bytes(activeEvidenceCids[j])) == keccak256(bytes(cid))) {
                            alreadyAdded = true;
                            break;
                        }
                    }
                    if (!alreadyAdded) {
                        activeEvidenceCids[activeEvidenceCount++] = cid;
                        evidenceRegistry[cid].usageScore++; // Increment usage score
                    }
                }
            }
        }

        finalActiveEvidenceCids = new string[](activeEvidenceCount);
        for(uint i = 0; i < activeEvidenceCount; i++){ finalActiveEvidenceCids[i] = activeEvidenceCids[i]; }

        return finalActiveEvidenceCids;
    }

    /**
     * @dev Distributes rewards to submitters and winning agents.
     */
    function _distributeRewards(
        string memory requestContext,
        string[] memory finalActiveEvidenceCids,
        string[] memory finalWinningAgentIds,
        uint256 submitterRewardPool,
        uint256 agentRewardPool
    ) internal {
        uint activeEvidenceCount = finalActiveEvidenceCids.length;
        uint winningAgentCount = finalWinningAgentIds.length;

        // Pay Submitters
        if (activeEvidenceCount > 0 && submitterRewardPool > 0) {
            uint256 submitterReward = submitterRewardPool / activeEvidenceCount;
            if (submitterReward > 0) {
                for (uint i = 0; i < activeEvidenceCount; i++) {
                    string memory cid = finalActiveEvidenceCids[i];
                    if (evidenceRegistry[cid].exists) {
                        address submitter = evidenceRegistry[cid].submitter;
                        if (submitter != address(0)) {
                            (bool sent, ) = payable(submitter).call{value: submitterReward}("");
                            if (sent) {
                                emit RewardPaid(requestContext, submitter, "Evidence Reward", cid, submitterReward);
                            } else {
                                emit RewardTransferFailed(submitter, "Evidence Reward", submitterReward);
                            }
                        } else {
                             emit AggregationError(requestContext, string.concat("Invalid submitter address for CID: ", cid));
                        }
                    }
                }
            }
        }

         // Pay Winning Agents
        if (winningAgentCount > 0 && agentRewardPool > 0) {
             uint256 agentReward = agentRewardPool / winningAgentCount;
             if (agentReward > 0) {
                 for (uint i = 0; i < winningAgentCount; i++) {
                     string memory agentId = finalWinningAgentIds[i];
                     address agentAddr = agentRegistry[agentId];
                     if (agentAddr != address(0)) {
                         (bool sent, ) = payable(agentAddr).call{value: agentReward}("");
                         if (sent) {
                              emit RewardPaid(requestContext, agentAddr, "Verifier Reward", "", agentReward);
                         } else {
                              emit RewardTransferFailed(agentAddr, "Verifier Reward", agentReward);
                         }
                     } else {
                         emit AggregationError(requestContext, string.concat("Agent not found or invalid address: ", agentId));
                     }
                 }
             }
        }
    }

    /**
     * @notice Helper function to convert uint to string (needed for error messages).
     */
    function uint2str(uint _i) internal pure returns (string memory _uintAsString) {
        if (_i == 0) {
            return "0";
        }
        uint j = _i;
        uint len;
        while (j != 0) {
            len++;
            j /= 10;
        }
        bytes memory bstr = new bytes(len);
        uint k = len;
        while (_i != 0) {
            k = k-1;
            uint8 temp = (48 + uint8(_i - _i / 10 * 10));
            bytes1 b1 = bytes1(temp);
            bstr[k] = b1;
            _i /= 10;
        }
        return string(bstr);
    }

    // --- View Functions ---

    function getAggregatedVerdict(string calldata requestContext) external view returns (AggregatedVerdict memory) {
        require(verdicts[requestContext].exists, "Aggregator: Verdict not yet aggregated for this context");
        return verdicts[requestContext];
    }

    function getSubmissions(string calldata requestContext) external view returns (VerifierSubmission[] memory) {
        return submissions[requestContext];
    }

    function getEvidenceInfo(string calldata cid) external view returns (EvidenceInfo memory) {
        return evidenceRegistry[cid];
    }

    function getAgentAddress(string calldata agentId) external view returns (address) {
        return agentRegistry[agentId];
    }
}