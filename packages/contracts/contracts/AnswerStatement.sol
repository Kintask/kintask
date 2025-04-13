// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

// Import EAS interfaces from your local copy.
import "./external/IEAS.sol";
import "./external/ISchemaRegistry.sol";
import "./external/Common.sol"; // for Attestation struct
import "hardhat/console.sol"; // <<< ADD THIS LINE

// --- Import the SEPARATE Interface Files ---
import "./IArbiter.sol"; // Import the separate file (though not directly implemented here)
import "./IStatement.sol"; // Import the separate file

// --- Data struct agents submit ---
struct AnswerResultData {
    address answeringAgent;
    string requestContextRef;
    uint256 requestContextHash;
    uint256 kbContentHash;
    uint256 questionHash;
    uint256 answerHash;
    uint256 llmResponseHash;
    uint256 answeringAgentId;
    uint8 claimedVerdict;
    uint8 claimedConfidence;
    uint256[2] proof_a;
    uint256[2][2] proof_b;
    uint256[2] proof_c;
    bytes32 evidenceProposalId;
    string answerCID;
    string evidenceDataCID;
}

// --- Main contract ---
// Now implements the imported IStatement
contract AnswerStatement is IStatement {
    IEAS public immutable _eas;
    ISchemaRegistry public immutable _schemaRegistry;
    bytes32 public immutable _ATTESTATION_SCHEMA;

    string public constant SCHEMA_ABI =
        "address answeringAgent,string requestContextRef,uint256 requestContextHash,uint256 kbContentHash,uint256 questionHash,uint256 answerHash,uint256 llmResponseHash,uint256 answeringAgentId,uint8 claimedVerdict,uint8 claimedConfidence,uint256[2] proof_a,uint256[2][2] proof_b,uint256[2] proof_c,bytes32 evidenceProposalId,string answerCID,string evidenceDataCID";
    bool public constant IS_REVOCABLE = false;

    event AnswerSubmitted(
        bytes32 indexed uid,
        address indexed agent,
        string requestContextRef
    );

    // Inside AnswerStatement.sol

    constructor(address easAddress, address schemaRegistryAddress) {
        _eas = IEAS(easAddress);
        _schemaRegistry = ISchemaRegistry(schemaRegistryAddress);
        bytes32 registeredUID = _schemaRegistry.register(SCHEMA_ABI, ISchemaResolver(address(0)), IS_REVOCABLE);

        // --- Use console.logBytes32 for bytes32 ---
    console.log("AnswerStatement Constructor - Registering Schema...");
        console.logBytes32(registeredUID); // Correct function for bytes32
        // --- End log ---

        _ATTESTATION_SCHEMA = registeredUID;
    }
    function makeStatement(
        AnswerResultData calldata data,
        bytes32 refUID
    ) external returns (bytes32 uid) {
        require(
            data.answeringAgent == msg.sender,
            "Caller must be answering agent"
        );
        bytes memory encodedData = abi.encode(
            data.answeringAgent,
            data.requestContextRef,
            data.requestContextHash,
            data.kbContentHash,
            data.questionHash,
            data.answerHash,
            data.llmResponseHash,
            data.answeringAgentId,
            data.claimedVerdict,
            data.claimedConfidence,
            data.proof_a,
            data.proof_b,
            data.proof_c,
            data.evidenceProposalId,
            data.answerCID,
            data.evidenceDataCID
        );
        uid = _eas.attest(
            AttestationRequest({
                schema: _ATTESTATION_SCHEMA,
                data: AttestationRequestData({
                    recipient: data.answeringAgent,
                    expirationTime: 0,
                    revocable: IS_REVOCABLE,
                    refUID: refUID,
                    data: encodedData,
                    value: 0
                })
            })
        );
        console.log("EMITTING!"); // Consider removing for production
        emit AnswerSubmitted(uid, data.answeringAgent, data.requestContextRef);
    }

    // --- IStatement checkStatement Implementation ---
    // Performs intrinsic checks on attestations created by *this* contract.
    function checkStatement(
        Attestation memory statement,
        bytes memory /*demand*/,
        bytes32 /*counteroffer*/
    ) public view virtual override returns (bool) {
        // Add 'virtual'
        if (statement.schema != _ATTESTATION_SCHEMA) return false;
        if (statement.revocationTime != 0) return false; // Cannot be revoked
        if (
            statement.expirationTime != 0 &&
            block.timestamp >= statement.expirationTime
        ) return false;
    // Add any other intrinsic checks specific to AnswerStatement if needed
        return true;
    }

    // --- IStatement Function Implementations ---
    function getSchemaAbi() public pure override returns (string memory) {
        return SCHEMA_ABI;
    }
    function getDemandAbi() public pure override returns (string memory) {
        return "";
    } // No specific demand format needed for intrinsic check
    function ATTESTATION_SCHEMA() public view override returns (bytes32) {
        return _ATTESTATION_SCHEMA;
    }
    function eas() public view override returns (IEAS) {
        return _eas;
    }

    // Note: checkFulfillment is NOT part of IStatement and is not needed here.
}
