// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Test.sol";
import {HonkVerifier} from "../src/generated/Verifier.sol";
import {GhostProverRegistry} from "../src/GhostProverRegistry.sol";

contract GhostProverRegistryTest is Test {
    HonkVerifier internal verifier;
    GhostProverRegistry internal registry;

    bytes internal proof;
    bytes32 internal commitment;
    bytes32 internal targetHash;

    bytes32 internal constant RECEIPT_EVENT_SIG =
        keccak256("ComplianceReceiptIssued(bytes32,bytes32,address,address,string,bytes32,uint256)");

    bytes32 internal constant BATCH_RECEIPT_EVENT_SIG =
        keccak256("ComplianceBatchReceiptIssued(bytes32,bytes32[],address,address,string,bytes32,uint256)");


    function setUp() public {
        verifier = new HonkVerifier();
        registry = new GhostProverRegistry(address(verifier));

        string memory root = vm.projectRoot();
        proof = vm.readFileBinary(string.concat(root, "/fixtures/proof.bin"));

        bytes memory publicInputs =
            vm.readFileBinary(string.concat(root, "/fixtures/public_inputs.bin"));
        require(publicInputs.length == 64, "unexpected public input length");

        bytes32 parsedCommitment;
        bytes32 parsedTargetHash;
        assembly {
            parsedCommitment := mload(add(publicInputs, 32))
            parsedTargetHash := mload(add(publicInputs, 64))
        }
        commitment = parsedCommitment;
        targetHash = parsedTargetHash;
    }

    function testValidProofEmitsReceipt() public {
        vm.recordLogs();
        registry.submitReceipt(proof, commitment, targetHash, address(0), "", bytes32(0));

        Vm.Log[] memory entries = vm.getRecordedLogs();
        require(entries.length == 1, "expected one log");
        require(entries[0].emitter == address(registry), "wrong emitter");
        require(entries[0].topics[0] == RECEIPT_EVENT_SIG, "wrong event");
        require(entries[0].topics[1] == commitment, "wrong commitment");
        require(entries[0].topics[2] == targetHash, "wrong target hash");
        require(
            entries[0].topics[3] == bytes32(uint256(uint160(address(this)))),
            "wrong submitter"
        );

        (address providerAddress, string memory modelId, bytes32 storageRoot, uint256 timestamp) =
            abi.decode(entries[0].data, (address, string, bytes32, uint256));
        require(providerAddress == address(0), "wrong provider");
        require(bytes(modelId).length == 0, "wrong modelId");
        require(storageRoot == bytes32(0), "wrong storageRoot");
        require(timestamp == block.timestamp, "wrong timestamp");
    }

    function testValidProofWithComputeFields() public {
        address provider = address(0xBEEF);
        string memory model = "qwen-2.5-7b-instruct";
        bytes32 root = keccak256("audit-bundle");

        vm.recordLogs();
        registry.submitReceipt(proof, commitment, targetHash, provider, model, root);

        Vm.Log[] memory entries = vm.getRecordedLogs();
        require(entries.length == 1, "expected one log");

        (address emittedProvider, string memory emittedModel, bytes32 emittedRoot, uint256 timestamp) =
            abi.decode(entries[0].data, (address, string, bytes32, uint256));
        require(emittedProvider == provider, "wrong provider");
        require(keccak256(bytes(emittedModel)) == keccak256(bytes(model)), "wrong model");
        require(emittedRoot == root, "wrong storage root");
        require(timestamp == block.timestamp, "wrong timestamp");
    }

    function testTamperedProofRejected() public {
        bytes memory badProof = proof;
        badProof[0] = bytes1(uint8(badProof[0]) ^ 0x01);

        (bool success,) =
            address(registry).call(abi.encodeCall(registry.submitReceipt, (badProof, commitment, targetHash, address(0), "", bytes32(0))));
        require(!success, "tampered proof should fail");
    }

    function testTamperedCommitmentRejected() public {
        bytes32 badCommitment = commitment ^ bytes32(uint256(1));

        (bool success,) =
            address(registry).call(abi.encodeCall(registry.submitReceipt, (proof, badCommitment, targetHash, address(0), "", bytes32(0))));
        require(!success, "tampered commitment should fail");
    }

    function testTamperedTargetHashRejected() public {
        bytes32 badTargetHash = targetHash ^ bytes32(uint256(1));

        (bool success,) =
            address(registry).call(abi.encodeCall(registry.submitReceipt, (proof, commitment, badTargetHash, address(0), "", bytes32(0))));
        require(!success, "tampered target hash should fail");
    }

    function testBatchReceiptEmitsEvent() public {
        bytes[] memory proofs = new bytes[](2);
        proofs[0] = proof;
        proofs[1] = proof;

        bytes32[] memory targetHashes = new bytes32[](2);
        targetHashes[0] = targetHash;
        targetHashes[1] = targetHash;

        vm.recordLogs();
        registry.submitBatchReceipt(proofs, commitment, targetHashes, address(0), "", bytes32(0));

        Vm.Log[] memory entries = vm.getRecordedLogs();
        require(entries.length == 1, "expected one log");
        require(entries[0].topics[0] == BATCH_RECEIPT_EVENT_SIG, "wrong event");
        require(entries[0].topics[1] == commitment, "wrong commitment");
    }

    function testBatchReceiptLengthMismatchRejected() public {
        bytes[] memory proofs = new bytes[](2);
        proofs[0] = proof;
        proofs[1] = proof;

        bytes32[] memory targetHashes = new bytes32[](1);
        targetHashes[0] = targetHash;

        (bool success,) =
            address(registry).call(abi.encodeCall(registry.submitBatchReceipt, (proofs, commitment, targetHashes, address(0), "", bytes32(0))));
        require(!success, "length mismatch should fail");
    }
}
