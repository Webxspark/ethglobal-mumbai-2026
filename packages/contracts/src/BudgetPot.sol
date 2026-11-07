// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IBudgetPot} from "./IBudgetPot.sol";

/// @title BudgetPot
/// @notice Owner-funded native pot; Escrow alone may pull rewards for tasks.
/// @dev Hedera-friendly: plain Solidity + msg.value (JSON-RPC / HBAR as native).
contract BudgetPot is IBudgetPot {
    address public override owner;
    uint256 public override balance;
    uint256 public override agentPassThreshold;
    /// @notice Cumulative amount pulled for tasks (encumbered or paid).
    uint256 public spent;
    /// @notice Sole authorized puller (Escrow).
    address public escrow;

    error NotOwner();
    error NotEscrow();
    error ZeroAmount();
    error InsufficientBalance();
    error TransferFailed();
    error EscrowAlreadySet();
    error ZeroAddress();

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event Pulled(bytes32 indexed taskId, address indexed to, uint256 amount);
    event EscrowSet(address indexed escrow);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_, uint256 agentPassThreshold_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        agentPassThreshold = agentPassThreshold_;
    }

    receive() external payable {
        _credit(msg.value);
    }

    /// @inheritdoc IBudgetPot
    function deposit() external payable override {
        _credit(msg.value);
    }

    /// @inheritdoc IBudgetPot
    function withdraw(uint256 amount) external override onlyOwner {
        if (amount == 0) revert ZeroAmount();
        if (amount > balance) revert InsufficientBalance();
        balance -= amount;
        _send(owner, amount);
        emit Withdrawn(owner, amount);
    }

    /// @notice Owner wires Escrow once after deploy.
    function setEscrow(address escrow_) external onlyOwner {
        if (escrow_ == address(0)) revert ZeroAddress();
        if (escrow != address(0)) revert EscrowAlreadySet();
        escrow = escrow_;
        emit EscrowSet(escrow_);
    }

    /// @notice Owner may raise/lower Agent Pass spend threshold (off-chain gate uses this view).
    function setAgentPassThreshold(uint256 threshold) external onlyOwner {
        agentPassThreshold = threshold;
    }

    /// @inheritdoc IBudgetPot
    function pullForTask(bytes32 taskId, address to, uint256 amount) external override {
        if (msg.sender != escrow) revert NotEscrow();
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > balance) revert InsufficientBalance();
        balance -= amount;
        spent += amount;
        _send(to, amount);
        emit Pulled(taskId, to, amount);
    }

    function _credit(uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        balance += amount;
        emit Deposited(msg.sender, amount);
    }

    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
