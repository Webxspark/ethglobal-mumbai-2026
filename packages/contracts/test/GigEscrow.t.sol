// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BudgetPot} from "../src/BudgetPot.sol";
import {GigEscrow} from "../src/GigEscrow.sol";

contract GigEscrowTest is Test {
    BudgetPot internal pot;
    GigEscrow internal escrow;

    address internal owner = makeAddr("owner");
    address internal operator = makeAddr("operator");
    address internal worker = makeAddr("worker");

    bytes32 internal constant TASK = keccak256("task-1");
    uint256 internal constant REWARD = 0.05 ether;

    function setUp() public {
        pot = new BudgetPot(owner, 1 ether);
        escrow = new GigEscrow(address(pot), operator);
        vm.prank(owner);
        pot.setEscrow(address(escrow));

        vm.deal(owner, 10 ether);
        vm.prank(owner);
        pot.deposit{value: 2 ether}();
    }

    function test_onlyOperator_lock_release() public {
        vm.prank(operator);
        escrow.lock(TASK, REWARD);
        assertEq(escrow.locked(TASK), REWARD);

        vm.prank(operator);
        escrow.release(TASK, worker);
        assertEq(escrow.locked(TASK), 0);
        assertEq(worker.balance, REWARD);
    }

    function test_onlyOperator_lock_refund() public {
        vm.prank(operator);
        escrow.lock(TASK, REWARD);

        uint256 potBefore = pot.balance();
        vm.prank(operator);
        escrow.refund(TASK);
        assertEq(escrow.locked(TASK), 0);
        assertEq(pot.balance(), potBefore + REWARD);
    }

    function test_revert_nonOperator() public {
        vm.expectRevert(GigEscrow.NotOperator.selector);
        escrow.lock(TASK, REWARD);

        vm.prank(operator);
        escrow.lock(TASK, REWARD);

        vm.expectRevert(GigEscrow.NotOperator.selector);
        escrow.release(TASK, worker);

        vm.expectRevert(GigEscrow.NotOperator.selector);
        escrow.refund(TASK);
    }

    function test_no_double_release() public {
        vm.startPrank(operator);
        escrow.lock(TASK, REWARD);
        escrow.release(TASK, worker);
        vm.expectRevert(GigEscrow.NothingLocked.selector);
        escrow.release(TASK, worker);
        vm.stopPrank();
    }

    function test_no_double_lock() public {
        vm.startPrank(operator);
        escrow.lock(TASK, REWARD);
        vm.expectRevert(GigEscrow.AlreadyLocked.selector);
        escrow.lock(TASK, REWARD);
        vm.stopPrank();
    }
}
