// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IVerifier} from "./generated/Verifier.sol";

/// @title GhostProverRegistry
/// @notice On-chain registry that verifies ZK non-inclusion proofs and issues
///         compliance receipts anchoring TEE-attested AI inference results.
/// @dev    The verifier is the Noir-generated Honk verifier for the
///         GhostProver circuit.  Each receipt binds a ZK proof to the 0G
///         Compute provider that executed the inference and the 0G Storage
///         root where the full audit bundle is archived.
contract GhostProverRegistry {
    IVerifier public immutable verifier;

    /// @notice Emitted when a valid ZK proof is submitted and verified.
    /// @param commitment      Poseidon2 hash of the prompt (indexed for lookup).
    /// @param targetHash      Poseidon2 hash of the sensitive field proven absent (indexed).
    /// @param submitter       Address that submitted the receipt.
    /// @param providerAddress 0G Compute provider that ran the inference inside TEE.
    /// @param modelId         Model identifier used for inference (e.g. "qwen-2.5-7b-instruct").
    /// @param storageRoot     0G Storage Merkle root of the archived audit bundle.
    /// @param timestamp       Block timestamp at the time of receipt issuance.
    event ComplianceReceiptIssued(
        bytes32 indexed commitment,
        bytes32 indexed targetHash,
        address indexed submitter,
        address providerAddress,
        string  modelId,
        bytes32 storageRoot,
        uint256 timestamp
    );

    constructor(address verifierAddress) {
        require(verifierAddress != address(0), "verifier required");
        verifier = IVerifier(verifierAddress);
    }

    /// @notice Submit a ZK proof of non-inclusion and issue an on-chain compliance receipt.
    /// @param proof           The raw ZK proof bytes from Barretenberg.
    /// @param commitment      Poseidon2 hash of the prompt (public input #1).
    /// @param targetHash      Poseidon2 hash of the target field (public input #2).
    /// @param providerAddress 0G Compute TEE provider that executed the inference.
    ///                        Pass address(0) in demo/local mode.
    /// @param modelId         Model identifier.  Pass "" in demo/local mode.
    /// @param storageRoot     0G Storage Merkle root.  Pass bytes32(0) in demo/local mode.
    function submitReceipt(
        bytes   calldata proof,
        bytes32 commitment,
        bytes32 targetHash,
        address providerAddress,
        string  calldata modelId,
        bytes32 storageRoot
    ) external {
        bytes32[] memory publicInputs = new bytes32[](2);
        publicInputs[0] = commitment;
        publicInputs[1] = targetHash;

        require(verifier.verify(proof, publicInputs), "invalid proof");

        emit ComplianceReceiptIssued(
            commitment,
            targetHash,
            msg.sender,
            providerAddress,
            modelId,
            storageRoot,
            block.timestamp
        );
    }
}
