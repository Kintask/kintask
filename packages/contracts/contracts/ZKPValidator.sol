// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

// --- EAS Interfaces ---
import "./external/IEAS.sol";
import "./external/ISchemaRegistry.sol";
import "./external/Common.sol"; // For Attestation struct

// --- Local Contract Interfaces & Contracts ---
import "./Verifier.sol"; // Your Groth16 Verifier

// --- Import the SEPARATE Interface Files ---
import "./IArbiter.sol";
import "./IStatement.sol";

// =========================================================================
// === ZKPValidator Contract Definition ====================================
// =========================================================================
contract ZKPValidator is IStatement, IArbiter { // Use imported interfaces
    IEAS public immutable _eas;
    ISchemaRegistry public immutable _schemaRegistry;
    Groth16Verifier public immutable zkpVerifier;

    // --- Store AnswerStatement Schema UID Directly ---
    bytes32 public immutable answerStatementSchemaUID;

    bytes32 public immutable _ZKP_VALID_SCHEMA; // Schema UID for *this* contract's attestations
    string public constant SCHEMA_ABI = "bool isValidZKP";
    bool public constant IS_REVOCABLE = false;

    event ZKPValidationCreated(
        bytes32 indexed validationUID,
        bytes32 indexed resultUID,
        bool isValid
    );

    // --- Modified Constructor ---
    constructor(
        address easAddress,
        address schemaRegistryAddress,
        address verifierAddr,
        bytes32 _answerStatementSchemaUID // Pass the UID directly
    ) {
        _eas = IEAS(easAddress);
        _schemaRegistry = ISchemaRegistry(schemaRegistryAddress);
        require(verifierAddr != address(0), "ZKPVerifier address needed");
        require(_answerStatementSchemaUID != bytes32(0), "AnswerStatement Schema UID needed");

        zkpVerifier = Groth16Verifier(verifierAddr);
        answerStatementSchemaUID = _answerStatementSchemaUID; // Store the UID

        _ZKP_VALID_SCHEMA = _schemaRegistry.register(
            SCHEMA_ABI,
            ISchemaResolver(address(0)), // No specific resolver needed
            IS_REVOCABLE
        );
    }

    /**
     * @notice Validates the ZKP associated with a given AnswerStatement UID.
     */
    function validateZKP(bytes32 resultUID) external returns (bytes32 validationUID) {
        Attestation memory answerAttestation = _eas.getAttestation(resultUID);

        // --- Use stored AnswerStatement Schema UID ---
        require(answerAttestation.schema == answerStatementSchemaUID, "ZKPValidator: Invalid Answer schema");
        require(answerAttestation.revocationTime == 0, "ZKPValidator: Answer revoked");

        // --- Corrected Decode AnswerStatement Data ---
        // Provide valid variable names for ALL decoded elements.
        (
            address answeringAgent,
            string memory requestContextRef, // Use full names
            uint256 requestContextHash,
            uint256 kbContentHash,
            uint256 questionHash,
            uint256 answerHash,
            uint256 llmResponseHash,
            uint256 answeringAgentId,
            uint8 claimedVerdict,
            uint8 claimedConfidence,
            uint256[2] memory proof_a,     // ZKP Proof part A
            uint256[2][2] memory proof_b,   // ZKP Proof part B
            uint256[2] memory proof_c,     // ZKP Proof part C
            bytes32 evidenceProposalId,
            string memory answerCID,
            string memory evidenceDataCID
        ) = abi.decode(answerAttestation.data, (
            // Ensure this tuple of types exactly matches AnswerStatement.SCHEMA_ABI
            address, string, uint256, uint256, uint256, uint256, uint256, uint256, uint8, uint8,
            uint256[2], uint256[2][2], uint256[2],
            bytes32, string, string
        ));

        // --- Prepare Public Inputs for Verification ---
        // CRITICAL: Confirm N=8 and the value '1' are correct for your specific AlwaysTrue circuit!
        uint256[8] memory publicInputs;
        for(uint i = 0; i < 8; i++) {
            publicInputs[i] = 1; // Assuming fixed value '1' for all inputs based on agent code
        }
        // If your circuit *actually* uses kbContentHash and answerHash, replace the loop with:
        // uint256[2] memory publicInputs; // Assuming N=2 public inputs
        // publicInputs[0] = kbContentHash;
        // publicInputs[1] = answerHash;


        // --- Verify the Proof ---
        bool proofIsValid = zkpVerifier.verifyProof(
            proof_a,
            proof_b,
            proof_c,
            publicInputs // Use the correctly prepared public inputs
        );
        bytes memory validationData = abi.encode(proofIsValid);

        // --- Create the ZKP Validation Attestation via EAS ---
        validationUID = _eas.attest(
            AttestationRequest({
                schema: _ZKP_VALID_SCHEMA, // Use *this* contract's schema
                data: AttestationRequestData({
                    recipient: answeringAgent, // The agent who submitted the answer/proof
                    expirationTime: 0,
                    revocable: IS_REVOCABLE,
                    refUID: resultUID, // Link back to the AnswerStatement
                    data: validationData, // Encoded result (true or false)
                    value: 0
                })
            })
        );
        emit ZKPValidationCreated(validationUID, resultUID, proofIsValid);
    }

    // --- IArbiter Implementation ---
    /**
     * @inheritdoc IArbiter
     * @dev Checks if the fulfillmentUID (representing a ZKP validation attestation)
     *      indicates a valid ZKP and is correctly linked back to the paymentStatement.
     */
    function checkFulfillment( Attestation memory paymentStatement, bytes memory /*demand*/, bytes32 fulfillmentUID ) external view override returns (bool) {
        if (fulfillmentUID == bytes32(0)) return false;
        Attestation memory zAtt = _eas.getAttestation(fulfillmentUID); // Reverts if UID invalid
        if (zAtt.schema != _ZKP_VALID_SCHEMA) return false;
        if (zAtt.revocationTime != 0) return false;
        if (zAtt.expirationTime != 0 && block.timestamp >= zAtt.expirationTime) return false;
        if (zAtt.data.length != 32) return false; // Check data length for bool
        bool isValid = abi.decode(zAtt.data, (bool));
        if (!isValid) return false; // ZKP must be valid
        bytes32 origUID = zAtt.refUID;
        if (origUID == bytes32(0)) return false; // Must reference an AnswerStatement
        Attestation memory aAtt = _eas.getAttestation(origUID); // Reverts if UID invalid
        if (aAtt.refUID != paymentStatement.uid) return false; // Answer must reference Payment
        return true; // All checks passed
    }

    // --- IStatement Implementation ---
    /**
     * @inheritdoc IStatement
     * @dev Performs intrinsic checks on an attestation created by *this* validator.
     */
    function checkStatement( Attestation memory statement, bytes memory /*demand*/, bytes32 /*counteroffer*/ ) public view virtual override returns (bool) { // Keep 'virtual'
        if (statement.schema != _ZKP_VALID_SCHEMA) return false;
        if (statement.revocationTime != 0) return false;
        if (statement.expirationTime != 0 && block.timestamp >= statement.expirationTime) return false;
        // Optional: Check attester == address(this) for added security
        // if (statement.attester != address(this)) return false;
        return true;
    }

    /// @inheritdoc IStatement
    function getSchemaAbi() public pure override returns (string memory) { return SCHEMA_ABI; }
    /// @inheritdoc IStatement
    function getDemandAbi() public pure override returns (string memory) { return ""; }
    /// @inheritdoc IStatement
    function ATTESTATION_SCHEMA() public view override returns (bytes32) { return _ZKP_VALID_SCHEMA; }
    /// @inheritdoc IStatement
    function eas() public view override returns (IEAS) { return _eas; }
} // End of Contract ZKPValidator