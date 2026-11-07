// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IBudgetPot
/// @notice Owner-funded pot that Escrow pulls rewards from.
/// @dev Stub interface — contracts lane implements BudgetPot.sol + tests.
interface IBudgetPot {
    function owner() external view returns (address);
    function balance() external view returns (uint256);
    function agentPassThreshold() external view returns (uint256);

    function deposit() external payable;
    function withdraw(uint256 amount) external;

    /// @notice Escrow-only pull when a task is funded / paid.
    function pullForTask(bytes32 taskId, address to, uint256 amount) external;
}
