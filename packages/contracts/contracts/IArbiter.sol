// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

// Import Common.sol if Attestation struct is needed and not globally available
// Assuming Common.sol defines the Attestation struct
import "./external/Common.sol"; // Adjust path as needed if Common.sol is elsewhere

/**
 * @title IArbiter Interface
 * @dev Defines the function required for an arbiter contract to validate a fulfillment
 *      in the context of a payment statement.
 */
interface IArbiter {
    /**
     * @notice Checks if a given fulfillment attestation is valid for a specific payment statement and demand.
     * @param paymentStatement The original payment statement attestation being settled.
     * @param demand The encoded demand data from the payment statement.
     * @param fulfillmentUID The UID of the attestation proposed as the fulfillment.
     * @return bool True if the fulfillmentUID represents a valid fulfillment for the paymentStatement.
     */
    function checkFulfillment(
        Attestation memory paymentStatement,
        bytes memory demand,
        bytes32 fulfillmentUID
    ) external view returns (bool);
}