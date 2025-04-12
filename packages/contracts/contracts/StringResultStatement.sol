// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

// Imports...
import "./external/IEAS.sol";
import "./external/ISchemaRegistry.sol";
import "./external/Common.sol";
import "./IArbiter.sol"; // Import if needed by checkFulfillment
import "./IStatement.sol";

// Data struct...
struct StringResultData { // Assuming this struct exists
    address fulfiller;
    string result;
}


contract StringResultStatement is IStatement, IArbiter { // Keep implementation list
    IEAS public immutable _eas;
    ISchemaRegistry public immutable _schemaRegistry;
    bytes32 public immutable _ATTESTATION_SCHEMA;

    string public constant SCHEMA_ABI = "address fulfiller,string result";
    string public constant DEMAND_ABI = "string query";
    bool public constant IS_REVOCABLE = false;

    event ResultSubmitted(bytes32 indexed uid, address indexed fulfiller, bytes32 indexed paymentStatementUID);

    constructor(address easAddress, address schemaRegistryAddress) {
        _eas = IEAS(easAddress);
        _schemaRegistry = ISchemaRegistry(schemaRegistryAddress);
        _ATTESTATION_SCHEMA = _schemaRegistry.register( SCHEMA_ABI, ISchemaResolver(address(0)), IS_REVOCABLE );
    }

    function makeStatement( string calldata result, bytes32 paymentStatementUID ) external returns (bytes32 uid) {
        // ... implementation ...
        require(bytes(result).length > 0, "Result empty"); require(paymentStatementUID != bytes32(0), "Invalid payment UID"); bytes memory encodedData = abi.encode( msg.sender, result ); uid = _eas.attest( AttestationRequest({ schema: _ATTESTATION_SCHEMA, data: AttestationRequestData({ recipient: msg.sender, expirationTime: 0, revocable: IS_REVOCABLE, refUID: paymentStatementUID, data: encodedData, value: 0 }) }) ); emit ResultSubmitted(uid, msg.sender, paymentStatementUID);
    }

    // --- IArbiter Implementation ---
    function checkFulfillment( Attestation memory paymentStatement, bytes memory demand, bytes32 fulfillmentUID ) external view override returns (bool) {
        // ... implementation ...
         Attestation memory fulfillment = _eas.getAttestation(fulfillmentUID); if (fulfillment.refUID != paymentStatement.uid) return false; if (fulfillment.schema != _ATTESTATION_SCHEMA) return false; if (fulfillment.revocationTime != 0) return false; string memory query = abi.decode(demand, (string)); (address fulfiller, string memory result) = abi.decode( fulfillment.data, (address, string) ); if (fulfiller != fulfillment.recipient) return false; return isUppercaseOf(result, query); // Assuming isUppercaseOf exists
    }

    // --- IStatement Implementation ---
    /**
     * @inheritdoc IStatement
     * @dev Performs intrinsic checks on attestations created by StringResultStatement.
     */
    function checkStatement( Attestation memory statement, bytes memory /*demand*/, bytes32 /*counteroffer*/ ) public view virtual override returns (bool) { // Add 'virtual'
        if (statement.schema != _ATTESTATION_SCHEMA) return false;
        if (statement.revocationTime != 0) return false; // Should not be revokable
        if (statement.expirationTime != 0 && block.timestamp >= statement.expirationTime) return false;
        // Add any other checks specific to StringResultStatement attestations if needed
        return true;
    }

    function ATTESTATION_SCHEMA() public view override returns (bytes32) { return _ATTESTATION_SCHEMA; }
    function eas() public view override returns (IEAS) { return _eas; }
    function getSchemaAbi() public pure override returns (string memory) { return SCHEMA_ABI; }
    function getDemandAbi() public pure override returns (string memory) { return DEMAND_ABI; } // Return the correct demand ABI

    // --- Helper Function ---
    function isUppercaseOf(string memory result, string memory query) internal pure returns (bool) {
        // ... implementation ...
         bytes memory resultBytes = bytes(result); bytes memory queryBytes = bytes(query); if (resultBytes.length != queryBytes.length) return false; for (uint i = 0; i < queryBytes.length; i++) { bytes1 qChar = queryBytes[i]; if (qChar >= 0x61 && qChar <= 0x7A) { qChar = bytes1(uint8(qChar) - 32); } if (qChar != resultBytes[i]) { return false; } } return true;
    }
}