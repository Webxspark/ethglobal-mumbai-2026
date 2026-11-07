// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ITeeVerifier
/// @notice 0G TeeML verdict digest + ecrecover surface used by Escrow.verify.
/// @dev Live TeeML inference stays off-chain; on-chain only checks the TEE signer.
interface ITeeVerifier {
    /// @notice Trusted 0G TeeML signer (demo key or rotated allowlist singleton).
    function teeSigner() external view returns (address);

    /// @notice Digest the escrow verifies: EIP-191 of keccak256(taskId, resultHash, approved).
    function verdictDigest(bytes32 taskId, bytes32 resultHash, bool approved)
        external
        pure
        returns (bytes32);

    /// @notice Recover signer from a 65-byte secp256k1 signature over `digest`.
    function recoverTeeSigner(bytes32 digest, bytes calldata teeSig)
        external
        pure
        returns (address);
}
