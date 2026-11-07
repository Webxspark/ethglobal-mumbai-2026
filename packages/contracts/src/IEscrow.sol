// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IEscrow
/// @notice Task lifecycle with SUBMITTED + verifyDeadline refund race guard.
/// @dev Stub interface — contracts lane implements Escrow.sol + RefundRace.t.sol first.
interface IEscrow {
    enum Status {
        OPEN,
        ACCEPTED,
        SUBMITTED,
        VERIFIED,
        PAID,
        CANCELLED,
        REFUNDED,
        DISPUTED
    }

    struct Task {
        bytes32 id;
        address pot;
        uint256 reward;
        Status status;
        address owner;
        address worker;
        bytes32 resultHash;
        uint64 verifyDeadline; // set on SUBMITTED
        bytes32 metadataHash;
    }

    /**
     * REFUND-RACE INVARIANT
     * - cancel/refund only while OPEN|ACCEPTED, or after verifyDeadline if still SUBMITTED (expireRefund).
     * - submit only from ACCEPTED → SUBMITTED + deadline.
     * - submit and refund mutually exclusive on status storage.
     */
    function createTask(
        address pot,
        uint256 reward,
        uint64 verifyWindowSecs,
        bytes32 metadataHash
    ) external returns (bytes32 taskId);

    function accept(bytes32 taskId, bytes32 humanNullifier) external;

    function submit(bytes32 taskId, bytes32 resultHash) external;

    /// @notice Legacy TeeML path — demoted; reverts. Use allSatisfied.
    function verify(bytes32 taskId, bytes calldata teeSig) external;

    /// @notice Posting-party agent release — ONLY happy path that pays the worker.
    function allSatisfied(bytes32 taskId) external;

    /// @notice Agent refuse / timeout → DISPUTED (report stub off-chain).
    function dispute(bytes32 taskId) external;

    function cancel(bytes32 taskId) external;

    function expireRefund(bytes32 taskId) external;

    function getTask(bytes32 taskId) external view returns (Task memory);
}
