// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {BudgetPot} from "../src/BudgetPot.sol";
import {Escrow} from "../src/Escrow.sol";
import {GigEscrow} from "../src/GigEscrow.sol";

/// @notice Deploy BudgetPot + Escrow and wire escrow pull rights.
/// @dev Required env:
///   DEPLOYER_PRIVATE_KEY — broadcaster; becomes pot owner (wires setEscrow)
///   TEE_SIGNER           — 0G TeeML ecrecover allowlist address
/// Optional:
///   AGENT_PASS_THRESHOLD_WEI — defaults to 1 ether
///
/// Example (Hedera local / JSON-RPC):
///   export DEPLOYER_PRIVATE_KEY=0x...
///   export TEE_SIGNER=0x...
///   forge script script/Deploy.s.sol:Deploy --rpc-url $HEDERA_RPC_URL --broadcast
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address teeSigner = vm.envAddress("TEE_SIGNER");
        address deployer = vm.addr(pk);
        uint256 threshold = vm.envOr("AGENT_PASS_THRESHOLD_WEI", uint256(1 ether));

        vm.startBroadcast(pk);

        BudgetPot pot = new BudgetPot(deployer, threshold);
        Escrow escrow = new Escrow(teeSigner);
        pot.setEscrow(address(escrow));

        vm.stopBroadcast();

        console2.log("BudgetPot", address(pot));
        console2.log("Escrow", address(escrow));
        console2.log("teeSigner", teeSigner);
        console2.log("potOwner", deployer);
        console2.log("agentPassThresholdWei", threshold);
    }
}

/// @notice BudgetPot + GigEscrow (operator locks per posted gig).
/// @dev Set GIG_ESCROW_ADDRESS to the logged GigEscrow address.
///      Operator defaults to deployer — use the same EVM key as PAYOUT_PRIVATE_KEY.
contract DeployGigEscrow is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        uint256 threshold = vm.envOr("AGENT_PASS_THRESHOLD_WEI", uint256(1 ether));
        address operator = vm.envOr("GIG_ESCROW_OPERATOR", deployer);

        vm.startBroadcast(pk);

        BudgetPot pot = new BudgetPot(deployer, threshold);
        GigEscrow gigEscrow = new GigEscrow(address(pot), operator);
        pot.setEscrow(address(gigEscrow));

        vm.stopBroadcast();

        console2.log("BudgetPot", address(pot));
        console2.log("GigEscrow", address(gigEscrow));
        console2.log("GIG_ESCROW_ADDRESS", address(gigEscrow));
        console2.log("BUDGET_POT_ADDRESS", address(pot));
        console2.log("operator", operator);
        console2.log("potOwner", deployer);
    }
}

