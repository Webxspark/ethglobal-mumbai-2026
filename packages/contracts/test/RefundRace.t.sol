// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BudgetPot} from "../src/BudgetPot.sol";
import {Escrow} from "../src/Escrow.sol";
import {IEscrow} from "../src/IEscrow.sol";

/**
 * @title RefundRace
 * @notice Refund-race invariant: SUBMITTED locks cancel until verifyDeadline;
 *         submit and cancel cannot both succeed for the same transition.
 */
contract RefundRaceTest is Test {
    uint256 internal constant TEE_PK = 0xA11CE;
    address internal teeSigner;
    address internal owner = address(0xB0B);
    address internal worker = address(0xA11);

    BudgetPot internal pot;
    Escrow internal escrow;

    uint64 internal constant WINDOW = 15 minutes;
    uint256 internal constant REWARD = 1 ether;

    function setUp() public {
        teeSigner = vm.addr(TEE_PK);
        vm.deal(owner, 100 ether);

        vm.prank(owner);
        pot = new BudgetPot(owner, 2 ether);

        escrow = new Escrow(teeSigner);

        vm.prank(owner);
        pot.setEscrow(address(escrow));

        vm.prank(owner);
        pot.deposit{value: 10 ether}();
    }

    function _createAccepted() internal returns (bytes32 taskId) {
        vm.prank(owner);
        taskId = escrow.createTask(address(pot), REWARD, WINDOW, keccak256("meta"));
        vm.prank(worker);
        escrow.accept(taskId, keccak256("nullifier"));
    }

    function test_cancel_succeeds_while_OPEN() public {
        vm.prank(owner);
        bytes32 taskId = escrow.createTask(address(pot), REWARD, WINDOW, keccak256("meta"));

        uint256 potBefore = pot.balance();
        vm.prank(owner);
        escrow.cancel(taskId);

        IEscrow.Task memory t = escrow.getTask(taskId);
        assertEq(uint8(t.status), uint8(IEscrow.Status.CANCELLED));
        assertEq(pot.balance(), potBefore + REWARD);
    }

    function test_cancel_succeeds_while_ACCEPTED() public {
        bytes32 taskId = _createAccepted();

        vm.prank(owner);
        escrow.cancel(taskId);

        assertEq(uint8(escrow.getTask(taskId).status), uint8(IEscrow.Status.CANCELLED));
    }

    function test_submit_sets_SUBMITTED_and_verifyDeadline() public {
        bytes32 taskId = _createAccepted();
        bytes32 resultHash = keccak256("proof");

        uint256 t0 = block.timestamp;
        vm.prank(worker);
        escrow.submit(taskId, resultHash);

        IEscrow.Task memory t = escrow.getTask(taskId);
        assertEq(uint8(t.status), uint8(IEscrow.Status.SUBMITTED));
        assertEq(t.resultHash, resultHash);
        assertEq(t.verifyDeadline, uint64(t0 + WINDOW));
    }

    function test_cancel_reverts_while_SUBMITTED_before_deadline() public {
        bytes32 taskId = _createAccepted();
        vm.prank(worker);
        escrow.submit(taskId, keccak256("proof"));

        vm.prank(owner);
        vm.expectRevert(Escrow.StillLocked.selector);
        escrow.cancel(taskId);
    }

    function test_expireRefund_succeeds_after_deadline_if_SUBMITTED() public {
        bytes32 taskId = _createAccepted();
        vm.prank(worker);
        escrow.submit(taskId, keccak256("proof"));

        IEscrow.Task memory mid = escrow.getTask(taskId);
        vm.warp(uint256(mid.verifyDeadline) + 1);

        uint256 potBefore = pot.balance();
        escrow.expireRefund(taskId);

        IEscrow.Task memory t = escrow.getTask(taskId);
        assertEq(uint8(t.status), uint8(IEscrow.Status.REFUNDED));
        assertEq(pot.balance(), potBefore + REWARD);
    }

    function test_expireRefund_reverts_before_deadline() public {
        bytes32 taskId = _createAccepted();
        vm.prank(worker);
        escrow.submit(taskId, keccak256("proof"));

        vm.expectRevert(Escrow.StillLocked.selector);
        escrow.expireRefund(taskId);
    }

    /// @notice Same-block race: once submit lands, cancel must fail (status mutex).
    function test_submit_then_cancel_same_block_only_submit_wins() public {
        bytes32 taskId = _createAccepted();

        vm.prank(worker);
        escrow.submit(taskId, keccak256("proof"));

        vm.prank(owner);
        vm.expectRevert(Escrow.StillLocked.selector);
        escrow.cancel(taskId);

        assertEq(uint8(escrow.getTask(taskId).status), uint8(IEscrow.Status.SUBMITTED));
    }

    /// @notice After verify, expireRefund must lose (terminal PAID).
    function test_verify_then_expireRefund_only_verify_wins() public {
        bytes32 taskId = _createAccepted();
        bytes32 resultHash = keccak256("proof");
        vm.prank(worker);
        escrow.submit(taskId, resultHash);

        bytes memory sig = _signVerdict(taskId, resultHash, true);
        vm.prank(owner);
        escrow.verify(taskId, sig);

        vm.warp(block.timestamp + WINDOW + 1);
        vm.expectRevert(Escrow.BadStatus.selector);
        escrow.expireRefund(taskId);

        assertEq(uint8(escrow.getTask(taskId).status), uint8(IEscrow.Status.PAID));
        assertEq(worker.balance, REWARD);
    }

    function _signVerdict(bytes32 taskId, bytes32 resultHash, bool approved)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = escrow.verdictDigest(taskId, resultHash, approved);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(TEE_PK, digest);
        return abi.encodePacked(r, s, v);
    }
}
