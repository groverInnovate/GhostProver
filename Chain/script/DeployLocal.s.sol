// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Script.sol";
import {HonkVerifier} from "../src/generated/Verifier.sol";
import {GhostProverRegistry} from "../src/GhostProverRegistry.sol";

contract DeployLocal is Script {
    function run() external returns (HonkVerifier deployedVerifier, GhostProverRegistry deployedRegistry) {
        vm.startBroadcast();
        deployedVerifier = new HonkVerifier();
        deployedRegistry = new GhostProverRegistry(address(deployedVerifier));
        vm.stopBroadcast();

        string memory root = vm.projectRoot();
        string memory json = vm.serializeAddress("deployment", "verifier", address(deployedVerifier));
        json = vm.serializeAddress("deployment", "registry", address(deployedRegistry));
        vm.writeJson(json, string.concat(root, "/deployments/local.json"));
    }
}
