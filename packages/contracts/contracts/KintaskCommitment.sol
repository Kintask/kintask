// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {TypesLib} from "blocklock-solidity/src/libraries/TypesLib.sol";
import {AbstractBlocklockReceiver} from "blocklock-solidity/src/AbstractBlocklockReceiver.sol";
import "hardhat/console.sol";

// Renamed contract
contract KintaskCommitment is AbstractBlocklockReceiver {

    // ... (Struct CommitmentData remains the same) ...
    struct CommitmentData { // No changes needed inside struct
        address requester;
        TypesLib.Ciphertext ciphertext;
        uint256 decryptionBlockNumber;
        bytes revealedVerdict;
        bool isRevealed;
    }

    // ... (Mapping commitments remains the same) ...
    mapping(uint256 => CommitmentData) public commitments;
    uint256 public nextRequestId = 1;

    // ... (Events VerdictCommitted, VerdictRevealed remain the same) ...
    event VerdictCommitted(
        uint256 indexed blocklockRequestId,
        address indexed requester,
        uint256 decryptionBlockNumber,
        bytes32 ciphertextHash
    );
    event VerdictRevealed(
        uint256 indexed blocklockRequestId,
        address indexed requester,
        bytes revealedVerdict
    );

    // ... (Errors InvalidRequestId, AlreadyRevealed remain the same) ...
    error InvalidRequestId();
    error AlreadyRevealed();

    // Constructor takes Blocklock proxy address
    constructor(address blocklockContractProxy) AbstractBlocklockReceiver(blocklockContractProxy) {}

    // Function commitVerdict remains the same logic
    function commitVerdict(uint256 decryptionBlockNumber, TypesLib.Ciphertext calldata encryptedData)
        external
        returns (uint256 blocklockRequestId)
    {
        require(encryptedData.v.length > 0, "Ciphertext cannot be empty");
        require(decryptionBlockNumber > block.number, "Decryption block must be in the future");

        blocklockRequestId = blocklock.requestBlocklock(decryptionBlockNumber, encryptedData);

        commitments[blocklockRequestId] = CommitmentData({
            requester: msg.sender,
            ciphertext: encryptedData,
            decryptionBlockNumber: decryptionBlockNumber,
            revealedVerdict: "",
            isRevealed: false
        });

        emit VerdictCommitted(
            blocklockRequestId,
            msg.sender,
            decryptionBlockNumber,
            keccak256(encryptedData.v)
        );
        console.log("Commitment made via KintaskCommitment with request ID:", blocklockRequestId);
        return blocklockRequestId;
    }

    // Function receiveBlocklock remains the same logic
    function receiveBlocklock(uint256 requestID, bytes calldata decryptionKey)
        external
        override
        onlyBlocklockContract
    {
        console.log("KintaskCommitment received blocklock callback for request ID:", requestID);
        CommitmentData storage commitment = commitments[requestID];

        if (commitment.requester == address(0)) {
            console.log("Error: Received callback for unknown request ID in KintaskCommitment");
            revert InvalidRequestId();
        }
        if (commitment.isRevealed) {
            console.log("Error: KintaskCommitment request already revealed");
            revert AlreadyRevealed();
        }

        bytes memory plaintext = blocklock.decrypt(commitment.ciphertext, decryptionKey);
        commitment.revealedVerdict = plaintext;
        commitment.isRevealed = true;

        emit VerdictRevealed(requestID, commitment.requester, plaintext);
        console.log("Verdict revealed via KintaskCommitment for request ID:", requestID);
    }

    // Helper view function remains the same
    function getCommitment(uint256 blocklockRequestId) external view returns (CommitmentData memory) {
        return commitments[blocklockRequestId];
    }
}