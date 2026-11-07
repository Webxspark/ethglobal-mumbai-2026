// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IBudgetPot} from "./IBudgetPot.sol";

/// @title GigEscrow
/// @notice Operator-driven per-gig native escrow backed by BudgetPot.pullForTask.
/// @dev Amounts are **tinybar** on Hedera (same as BudgetPot accounting).
contract GigEscrow {
    address public immutable pot;
    address public operator;

    mapping(bytes32 => uint256) public locked;

    error NotOperator();
    error ZeroAmount();
    error AlreadyLocked();
    error NothingLocked();
    error TransferFailed();

    event Locked(bytes32 indexed taskId, uint256 amount);
    event Released(bytes32 indexed taskId, address indexed worker, uint256 amount);
    event Refunded(bytes32 indexed taskId, uint256 amount);

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(address pot_, address operator_) {
        pot = pot_;
        operator = operator_;
    }

    receive() external payable {}

    /// @notice Pull reward from BudgetPot into this contract for a task.
    function lock(bytes32 taskId, uint256 amount) external onlyOperator {
        if (amount == 0) revert ZeroAmount();
        if (locked[taskId] != 0) revert AlreadyLocked();
        IBudgetPot(pot).pullForTask(taskId, address(this), amount);
        locked[taskId] = amount;
        emit Locked(taskId, amount);
    }

    /// @notice Pay worker and clear escrow (no double release).
    function release(bytes32 taskId, address worker) external onlyOperator {
        uint256 amount = locked[taskId];
        if (amount == 0) revert NothingLocked();
        locked[taskId] = 0;
        (bool ok,) = worker.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Released(taskId, worker, amount);
    }

    /// @notice Return locked funds to BudgetPot (receive credits balance).
    function refund(bytes32 taskId) external onlyOperator {
        uint256 amount = locked[taskId];
        if (amount == 0) revert NothingLocked();
        locked[taskId] = 0;
        (bool ok,) = pot.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Refunded(taskId, amount);
    }
}
