// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

// --- EAS & OpenZeppelin Imports ---
import "./external/IEAS.sol";
import "./external/ISchemaRegistry.sol";
import "./external/Common.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// --- Import the SEPARATE Interface Files ---
import "./IArbiter.sol";
import "./IStatement.sol";

// --- Payment Data Struct ---
struct PaymentStatementData {
    address buyer;
    address token;
    uint256 amount;
    address arbiter;
    bytes demand;
    bool active;
}

// --- Main Contract ---
contract ERC20PaymentStatement is IStatement {
    using SafeERC20 for IERC20;

    IEAS public immutable _eas;
    ISchemaRegistry public immutable _schemaRegistry;
    bytes32 public immutable _ATTESTATION_SCHEMA;
    string public constant SCHEMA_ABI = "address buyer,address token,uint256 amount,address arbiter,bytes demand,bool active";
    string public constant DEMAND_ABI = "address token, uint256 minAmount, address arbiter, bytes demandHash";
    bool public constant IS_REVOCABLE = true;
    mapping(bytes32 => bool) public usedStatements;

    event PaymentStatementCreated( bytes32 indexed uid, address indexed buyer, address token, uint256 amount, address arbiter );
    event PaymentCollected( bytes32 indexed statementUID, bytes32 indexed fulfillmentUID, address indexed collector, uint256 amount );
    event PaymentStatementCancelled(bytes32 indexed uid, address indexed buyer);

    constructor(address easAddress, address schemaRegistryAddress) {
        _eas = IEAS(easAddress);
        _schemaRegistry = ISchemaRegistry(schemaRegistryAddress);
        _ATTESTATION_SCHEMA = _schemaRegistry.register( SCHEMA_ABI, ISchemaResolver(address(0)), IS_REVOCABLE );
    }

    function makeStatement( address token, uint256 amount, address arbiter, bytes calldata demand ) external payable returns (bytes32 uid) {
        require(amount > 0, "Amount must be > 0");
        require(arbiter != address(0), "Invalid arbiter address");
        if (token == address(0)) { require(msg.value == amount, "Incorrect native value sent");
        } else { require(msg.value == 0, "Do not send native value for ERC20 payments"); IERC20(token).safeTransferFrom(msg.sender, address(this), amount); }
        PaymentStatementData memory statementData = PaymentStatementData({ buyer: msg.sender, token: token, amount: amount, arbiter: arbiter, demand: demand, active: true });
        bytes memory encodedData = abi.encode(statementData);
        uid = _eas.attest( AttestationRequest({ schema: _ATTESTATION_SCHEMA, data: AttestationRequestData({ recipient: msg.sender, expirationTime: 0, revocable: IS_REVOCABLE, refUID: bytes32(0), data: encodedData, value: 0 }) }) );
        emit PaymentStatementCreated(uid, msg.sender, token, amount, arbiter);
    }

    function collectPayment( bytes32 paymentUID, bytes32 fulfillmentUID ) external {
        Attestation memory statement = _eas.getAttestation(paymentUID);
        require(!usedStatements[paymentUID], "Payment already collected/cancelled");
        require(statement.revocationTime == 0, "Payment statement was revoked");
        require(statement.schema == _ATTESTATION_SCHEMA, "Invalid payment statement schema");

        // --- Corrected: Decode without try/catch ---
        // If statement.data is malformed, abi.decode will revert, failing the transaction, which is desired.
        PaymentStatementData memory decodedData = abi.decode(statement.data, (PaymentStatementData));

        require(decodedData.active, "Payment statement is inactive");
        require( IArbiter(decodedData.arbiter).checkFulfillment(statement, decodedData.demand, fulfillmentUID), "ERC20PaymentStatement: Invalid fulfillment via arbiter" );

        usedStatements[paymentUID] = true;
        if (decodedData.token == address(0)) { (bool success, ) = msg.sender.call{value: decodedData.amount}(""); require(success, "Native token transfer failed");
        } else { IERC20(decodedData.token).safeTransfer(msg.sender, decodedData.amount); }
        emit PaymentCollected(paymentUID, fulfillmentUID, msg.sender, decodedData.amount);
    }

    function cancelStatement(bytes32 paymentUID) external {
        Attestation memory statement = _eas.getAttestation(paymentUID);
        require(statement.schema == _ATTESTATION_SCHEMA, "Invalid schema for cancellation");
        require(!usedStatements[paymentUID], "Payment already collected/cancelled");
        require(statement.revocationTime == 0, "Payment statement already revoked");

        // --- Corrected: Decode without try/catch ---
        // If statement.data is malformed, abi.decode will revert.
        PaymentStatementData memory decodedData = abi.decode(statement.data, (PaymentStatementData));

        require(msg.sender == decodedData.buyer, "Only the buyer can cancel");
        require(decodedData.active, "Statement already inactive");

        usedStatements[paymentUID] = true;
        _eas.revoke( RevocationRequest({ schema: _ATTESTATION_SCHEMA, data: RevocationRequestData({uid: paymentUID, value: 0}) }) );
        if (decodedData.token == address(0)) { (bool success, ) = decodedData.buyer.call{value: decodedData.amount}(""); require(success, "Native token refund failed");
        } else { IERC20(decodedData.token).safeTransfer(decodedData.buyer, decodedData.amount); }
        emit PaymentStatementCancelled(paymentUID, decodedData.buyer);
    }

    function ATTESTATION_SCHEMA() public view override returns (bytes32) { return _ATTESTATION_SCHEMA; }
    function eas() public view override returns (IEAS) { return _eas; }
    function getSchemaAbi() public pure override returns (string memory) { return SCHEMA_ABI; }
    function getDemandAbi() public pure override returns (string memory) { return DEMAND_ABI; }

    // --- Corrected checkStatement implementation ---
    function checkStatement( Attestation memory statement, bytes memory /*demand*/, bytes32 /*counteroffer*/ ) public view virtual override returns (bool) {
        if (statement.schema != _ATTESTATION_SCHEMA) return false;
        if (statement.revocationTime != 0) return false;
        if (statement.expirationTime != 0 && block.timestamp >= statement.expirationTime) return false;

        // --- Corrected: Decode without try/catch ---
        // Add a basic length check beforehand for robustness, comparing against expected encoded size.
        // Size = 5 * 32 bytes (address, address, uint256, address, bool) + size_of_bytes_demand
        // For the bool check, we only need the first 5*32 bytes.
        // Note: This check is approximate as 'demand' size varies.
        // A truly robust check would require more complex validation or relying on decode revert.
        uint expectedMinSize = 5 * 32; // Size excluding dynamic bytes 'demand'
        if (statement.data.length < expectedMinSize) {
             return false; // Data too short to possibly contain all fixed fields
        }

        // Decode the full data structure. If data is invalid/malformed, this will REVERT.
        PaymentStatementData memory decodedData = abi.decode(statement.data, (PaymentStatementData));

        // Check the 'active' flag from the decoded data
        if (!decodedData.active) {
            return false;
        }

        return true; // Passed all intrinsic checks
    }
}