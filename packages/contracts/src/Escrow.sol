// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IBudgetPot} from "./IBudgetPot.sol";
import {IEscrow} from "./IEscrow.sol";
import {ITeeVerifier} from "./ITeeVerifier.sol";

/// @title Escrow
/// @notice Task lifecycle with SUBMITTED lock + verifyDeadline refund-race guard.
/// @dev Settlement SoT. TeeML is ecrecover'd on verify; live 0G call is off-chain.
contract Escrow is IEscrow, ITeeVerifier {
    address public override teeSigner;

    mapping(bytes32 => Task) private _tasks;
    mapping(bytes32 => uint64) public verifyWindowSecs;

    uint256 private _nonce;

    error TaskExists();
    error UnknownTask();
    error BadStatus();
    error NotTaskOwner();
    error NotWorker();
    error ZeroReward();
    error ZeroWindow();
    error ZeroAddress();
    error StillLocked();
    error DeadlineNotPassed();
    error BadTeeSignature();
    error TeePathDemoted();
    error TransferFailed();
    error NotPotOwner();
    error MissingEvidence();

    event TaskCreated(bytes32 indexed taskId, address indexed pot, address indexed owner, uint256 reward);
    event TaskAccepted(bytes32 indexed taskId, address indexed worker, bytes32 humanNullifier);
    event TaskSubmitted(bytes32 indexed taskId, bytes32 resultHash, uint64 verifyDeadline);
    event TaskVerified(bytes32 indexed taskId, address teeSigner);
    event AgentSatisfied(bytes32 indexed taskId, address indexed owner);
    event TaskDisputed(bytes32 indexed taskId, address indexed owner);
    event TaskPaid(bytes32 indexed taskId, address indexed worker, uint256 amount);
    event TaskCancelled(bytes32 indexed taskId);
    event TaskRefunded(bytes32 indexed taskId);

    constructor(address teeSigner_) {
        if (teeSigner_ == address(0)) revert ZeroAddress();
        teeSigner = teeSigner_;
    }

    receive() external payable {}

    // ── ITeeVerifier ─────────────────────────────────────────────────────────

    /// @inheritdoc ITeeVerifier
    function verdictDigest(bytes32 taskId, bytes32 resultHash, bool approved)
        public
        pure
        override
        returns (bytes32)
    {
        bytes32 inner = keccak256(abi.encode(taskId, resultHash, approved));
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", inner));
    }

    /// @inheritdoc ITeeVerifier
    function recoverTeeSigner(bytes32 digest, bytes calldata teeSig)
        public
        pure
        override
        returns (address)
    {
        if (teeSig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(teeSig.offset)
            s := calldataload(add(teeSig.offset, 32))
            v := byte(0, calldataload(add(teeSig.offset, 64)))
        }
        if (v < 27) v += 27;
        return ecrecover(digest, v, r, s);
    }

    // ── IEscrow ──────────────────────────────────────────────────────────────

    /// @inheritdoc IEscrow
    function createTask(
        address pot,
        uint256 reward,
        uint64 verifyWindowSecs_,
        bytes32 metadataHash
    ) external override returns (bytes32 taskId) {
        if (pot == address(0)) revert ZeroAddress();
        if (reward == 0) revert ZeroReward();
        if (verifyWindowSecs_ == 0) revert ZeroWindow();
        if (msg.sender != IBudgetPot(pot).owner()) revert NotPotOwner();

        taskId = keccak256(abi.encode(msg.sender, pot, reward, metadataHash, _nonce++));
        if (_tasks[taskId].owner != address(0)) revert TaskExists();

        // Encumber: pull reward into this escrow for the task lifetime.
        IBudgetPot(pot).pullForTask(taskId, address(this), reward);

        _tasks[taskId] = Task({
            id: taskId,
            pot: pot,
            reward: reward,
            status: Status.OPEN,
            owner: msg.sender,
            worker: address(0),
            resultHash: bytes32(0),
            verifyDeadline: 0,
            metadataHash: metadataHash
        });
        verifyWindowSecs[taskId] = verifyWindowSecs_;

        emit TaskCreated(taskId, pot, msg.sender, reward);
    }

    /// @inheritdoc IEscrow
    function accept(bytes32 taskId, bytes32 humanNullifier) external override {
        Task storage t = _requireTask(taskId);
        if (t.status != Status.OPEN) revert BadStatus();
        t.status = Status.ACCEPTED;
        t.worker = msg.sender;
        emit TaskAccepted(taskId, msg.sender, humanNullifier);
    }

    /// @inheritdoc IEscrow
    function submit(bytes32 taskId, bytes32 resultHash) external override {
        Task storage t = _requireTask(taskId);
        if (t.status != Status.ACCEPTED) revert BadStatus();
        if (msg.sender != t.worker) revert NotWorker();

        uint64 deadline = uint64(block.timestamp) + verifyWindowSecs[taskId];
        t.status = Status.SUBMITTED;
        t.resultHash = resultHash;
        t.verifyDeadline = deadline;

        emit TaskSubmitted(taskId, resultHash, deadline);
    }

    /// @inheritdoc IEscrow
    /// @dev Hybrid pivot — TeeML ecrecover alone must not release funds.
    function verify(bytes32 taskId, bytes calldata /* teeSig */) external override {
        Task storage t = _requireTask(taskId);
        if (t.status != Status.SUBMITTED) revert BadStatus();
        if (msg.sender != t.owner) revert NotTaskOwner();
        revert TeePathDemoted();
    }

    /// @inheritdoc IEscrow
    /// @dev Posting agent satisfaction is the only happy-path payout.
    function allSatisfied(bytes32 taskId) external override {
        Task storage t = _requireTask(taskId);
        if (t.status != Status.SUBMITTED) revert BadStatus();
        if (msg.sender != t.owner) revert NotTaskOwner();
        if (t.resultHash == bytes32(0)) revert MissingEvidence();

        t.status = Status.VERIFIED;
        emit AgentSatisfied(taskId, msg.sender);

        address worker = t.worker;
        uint256 amount = t.reward;
        t.status = Status.PAID;
        _send(worker, amount);
        emit TaskPaid(taskId, worker, amount);
    }

    /// @inheritdoc IEscrow
    function dispute(bytes32 taskId) external override {
        Task storage t = _requireTask(taskId);
        if (t.status != Status.SUBMITTED && t.status != Status.ACCEPTED) revert BadStatus();
        if (msg.sender != t.owner) revert NotTaskOwner();
        t.status = Status.DISPUTED;
        emit TaskDisputed(taskId, msg.sender);
    }

    /// @inheritdoc IEscrow
    function cancel(bytes32 taskId) external override {
        Task storage t = _requireTask(taskId);
        if (msg.sender != t.owner) revert NotTaskOwner();

        Status s = t.status;
        if (s == Status.OPEN || s == Status.ACCEPTED) {
            t.status = Status.CANCELLED;
            _refundToPot(t);
            emit TaskCancelled(taskId);
            return;
        }

        // SUBMITTED before deadline: refund race lock — cancel must lose.
        if (s == Status.SUBMITTED) {
            if (block.timestamp <= t.verifyDeadline) revert StillLocked();
            revert DeadlineNotPassed(); // use expireRefund after deadline
        }

        revert BadStatus();
    }

    /// @inheritdoc IEscrow
    function expireRefund(bytes32 taskId) external override {
        Task storage t = _requireTask(taskId);
        if (t.status != Status.SUBMITTED) revert BadStatus();
        if (block.timestamp <= t.verifyDeadline) revert StillLocked();

        t.status = Status.REFUNDED;
        _refundToPot(t);
        emit TaskRefunded(taskId);
    }

    /// @inheritdoc IEscrow
    function getTask(bytes32 taskId) external view override returns (Task memory) {
        Task memory t = _tasks[taskId];
        if (t.owner == address(0)) revert UnknownTask();
        return t;
    }

    function _requireTask(bytes32 taskId) internal view returns (Task storage t) {
        t = _tasks[taskId];
        if (t.owner == address(0)) revert UnknownTask();
    }

    function _refundToPot(Task storage t) internal {
        uint256 amount = t.reward;
        // Return encumbered funds to the pot (not the agent).
        (bool ok,) = t.pot.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
