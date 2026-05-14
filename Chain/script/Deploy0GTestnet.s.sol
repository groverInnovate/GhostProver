// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Script.sol";
import {HonkVerifier} from "../src/generated/Verifier.sol";
import {GhostProverRegistry} from "../src/GhostProverRegistry.sol";

/// @title Deploy0GTestnet
/// @notice Deploy GhostProver contracts to 0G Chain testnet
/// @dev Run with:
///   forge script script/Deploy0GTestnet.s.sol:Deploy0GTestnet \
///     --rpc-url https://evmrpc-testnet.0g.ai \
///     --private-key $PRIVATE_KEY \
///     --broadcast \
///     --verify
contract Deploy0GTestnet is Script {
    function run() external returns (HonkVerifier deployedVerifier, GhostProverRegistry deployedRegistry) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy the Honk verifier first
        deployedVerifier = new HonkVerifier();
        console.log("HonkVerifier deployed at:", address(deployedVerifier));
        
        // Deploy the registry with the verifier address
        deployedRegistry = new GhostProverRegistry(address(deployedVerifier));
        console.log("GhostProverRegistry deployed at:", address(deployedRegistry));
        
        vm.stopBroadcast();

        // Write deployment addresses to JSON
        string memory root = vm.projectRoot();
        string memory json = vm.serializeAddress("deployment", "verifier", address(deployedVerifier));
        json = vm.serializeAddress("deployment", "registry", address(deployedRegistry));
        json = vm.serializeUint("deployment", "chainId", block.chainid);
        json = vm.serializeString("deployment", "network", "0g-testnet");
        vm.writeJson(json, string.concat(root, "/deployments/0g-testnet.json"));
        
        console.log("Deployment saved to deployments/0g-testnet.json");
    }
}
