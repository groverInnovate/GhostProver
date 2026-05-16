// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Script.sol";
import {HonkVerifier} from "../src/generated/Verifier.sol";
import {GhostProverRegistry} from "../src/GhostProverRegistry.sol";

/// @title Deploy0G
/// @notice Deploy GhostProver verifier + registry to any 0G EVM network.
/// @dev Mainnet:
///   forge script script/Deploy0G.s.sol:Deploy0G \
///     --rpc-url https://evmrpc.0g.ai \
///     --private-key $PRIVATE_KEY \
///     --broadcast
contract Deploy0G is Script {
    function run() external returns (HonkVerifier deployedVerifier, GhostProverRegistry deployedRegistry) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        deployedVerifier = new HonkVerifier();
        console.log("HonkVerifier deployed at:", address(deployedVerifier));

        deployedRegistry = new GhostProverRegistry(address(deployedVerifier));
        console.log("GhostProverRegistry deployed at:", address(deployedRegistry));

        vm.stopBroadcast();

        string memory network = _deploymentNetwork();
        string memory root = vm.projectRoot();
        string memory json = vm.serializeAddress("deployment", "verifier", address(deployedVerifier));
        json = vm.serializeAddress("deployment", "registry", address(deployedRegistry));
        json = vm.serializeUint("deployment", "chainId", block.chainid);
        json = vm.serializeString("deployment", "network", network);
        vm.writeJson(json, string.concat(root, "/deployments/", network, ".json"));

        console.log("Deployment saved to deployments/%s.json", network);
    }

    function _deploymentNetwork() internal view returns (string memory) {
        try vm.envString("DEPLOYMENT_NETWORK") returns (string memory configured) {
            if (bytes(configured).length > 0) {
                return configured;
            }
        } catch {}

        if (block.chainid == 16661) return "0g-mainnet";
        if (block.chainid == 16602) return "0g-testnet";
        return "local";
    }
}
