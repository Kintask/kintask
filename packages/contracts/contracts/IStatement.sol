// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

// Import external interfaces needed by functions defined here
import "./external/IEAS.sol"; // Adjust path as needed
import "./external/Common.sol"; // Adjust path as needed

/**
 * @title IStatement Interface
 * @dev Defines common functions for contracts that create EAS attestations
 *      representing statements, offers, or validations within the system.
 */
interface IStatement {
    /**
     * @notice Returns the EAS Schema UID used by this statement contract.
     */
    function ATTESTATION_SCHEMA() external view returns (bytes32);

    /**
     * @notice Returns the EAS contract instance used.
     */
    function eas() external view returns (IEAS);

    /**
     * @notice Returns the ABI definition of the data stored within this contract's attestations.
     */
    function getSchemaAbi() external pure returns (string memory);

    /**
     * @notice Returns the ABI definition of the demand data expected by this contract's checkStatement function.
     */
    function getDemandAbi() external pure returns (string memory);

    /**
     * @notice Performs intrinsic checks on an attestation claiming to be from this contract.
     * @param statement The attestation to check.
     * @param demand Contextual demand data (may be unused for intrinsic checks).
     * @param counteroffer Contextual counteroffer UID (may be unused for intrinsic checks).
     * @return bool True if the statement appears to be a valid, active attestation from this contract type.
     */
    function checkStatement(
        Attestation memory statement,
        bytes memory demand,
        bytes32 counteroffer
    ) external view returns (bool);
}