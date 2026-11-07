// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BudgetPot} from "../src/BudgetPot.sol";
import {Escrow} from "../src/Escrow.sol";
import {IEscrow} from "../src/IEscrow.sol";

/**
 * @title HappyPath
 * @notice fund → create → accept → submit → allSatisfied/pay, plus OPEN refund.
 */
contract HappyPathTest is Test {
    uint256 internal constant TEE_PK = 0xA11CE;
    address internal teeSigner;
    address internal owner = address(0xB0B);
    address internal worker = address(0xA11);

    BudgetPot internal pot;
    Escrow internal escrow;

    uint64 internal constant WINDOW = 15 minutes;
    uint256 internal constant REWARD = 0.5 ether;

    function setUp() public {
        teeSigner = vm.addr(TEE_PK);
        vm.deal(owner, 50 ether);

        pot = new BudgetPot(owner, 1 ether);
        escrow = new Escrow(teeSigner);

        vm.prank(owner);
        pot.setEscrow(address(escrow));
    }

    function test_fund_submit_allSatisfied_pays_worker() public {
        vm.prank(owner);
        pot.deposit{value: 5 ether}();
        assertEq(pot.balance(), 5 ether);

        vm.prank(owner);
        bytes32 taskId = escrow.createTask(address(pot), REWARD, WINDOW, keccak256("cid"));
        assertEq(pot.balance(), 5 ether - REWARD);
        assertEq(address(escrow).balance, REWARD);

        vm.prank(worker);
        escrow.accept(taskId, keccak256("human"));

        bytes32 resultHash = keccak256("photo+codeword");
        vm.prank(worker);
        escrow.submit(taskId, resultHash);

        vm.prank(owner);
        escrow.allSatisfied(taskId);

        IEscrow.Task memory t = escrow.getTask(taskId);
        assertEq(uint8(t.status), uint8(IEscrow.Status.PAID));
        assertEq(worker.balance, REWARD);
        assertEq(address(escrow).balance, 0);
    }

    function test_verify_tee_path_demoted() public {
        vm.prank(owner);
        pot.deposit{value: 2 ether}();

        vm.prank(owner);
        bytes32 taskId = escrow.createTask(address(pot), REWARD, WINDOW, keccak256("cid"));
        vm.prank(worker);
        escrow.accept(taskId, keccak256("human"));
        bytes32 resultHash = keccak256("proof");
        vm.prank(worker);
        escrow.submit(taskId, resultHash);

        bytes memory sig = _sign(taskId, resultHash, true);
        vm.prank(owner);
        vm.expectRevert(Escrow.TeePathDemoted.selector);
        escrow.verify(taskId, sig);
    }

    function test_dispute_after_submit() public {
        vm.prank(owner);
        pot.deposit{value: 2 ether}();

        vm.prank(owner);
        bytes32 taskId = escrow.createTask(address(pot), REWARD, WINDOW, keccak256("cid"));
        vm.prank(worker);
        escrow.accept(taskId, keccak256("human"));
        vm.prank(worker);
        escrow.submit(taskId, keccak256("proof"));

        vm.prank(owner);
        escrow.dispute(taskId);

        assertEq(uint8(escrow.getTask(taskId).status), uint8(IEscrow.Status.DISPUTED));
        assertEq(worker.balance, 0);
    }

    function test_refund_open_task_returns_to_pot() public {
        vm.prank(owner);
        pot.deposit{value: 3 ether}();

        vm.prank(owner);
        bytes32 taskId = escrow.createTask(address(pot), REWARD, WINDOW, keccak256("cid"));

        uint256 beforeBal = pot.balance();
        vm.prank(owner);
        escrow.cancel(taskId);

        assertEq(pot.balance(), beforeBal + REWARD);
        assertEq(uint8(escrow.getTask(taskId).status), uint8(IEscrow.Status.CANCELLED));
    }

    function test_teeSigner_view_matches_constructor() public view {
        assertEq(escrow.teeSigner(), teeSigner);
    }

    function _sign(bytes32 taskId, bytes32 resultHash, bool approved)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = escrow.verdictDigest(taskId, resultHash, approved);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(TEE_PK, digest);
        return abi.encodePacked(r, s, v);
    }
}
