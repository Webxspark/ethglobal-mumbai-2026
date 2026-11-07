# `@proofwork/contracts`

BudgetPot + Escrow + **GigEscrow** (operator lock/release/refund per posted gig) for PROOFWORK v2 (Hedera-friendly Solidity / Foundry).

## What shipped

| Contract | Role |
|----------|------|
| `BudgetPot` | Owner deposits native value; Escrow-only `pullForTask` |
| `Escrow` | OPEN → ACCEPTED → SUBMITTED → VERIFIED → PAID; cancel / expireRefund |
| `ITeeVerifier` | TeeML digest + `ecrecover` surface used by `verify` |

**Refund race:** while `SUBMITTED` and `block.timestamp <= verifyDeadline`, `cancel` reverts. After the deadline, `expireRefund` returns funds to the pot. `verify` pays the worker and leaves `expireRefund` terminal.

## Tests

```bash
# Foundry on PATH (https://book.getfoundry.sh/getting-started/installation)
cd packages/contracts
forge test
```

Suites: `RefundRace.t.sol`, `HappyPath.t.sol`.

## Deploy

Env vars:

| Variable | Required | Meaning |
|----------|----------|---------|
| `DEPLOYER_PRIVATE_KEY` | yes | Broadcaster; becomes pot owner and calls `setEscrow` |
| `TEE_SIGNER` | yes | Address whose secp256k1 sig Escrow accepts on verify (0G TeeML demo key) |
| `AGENT_PASS_THRESHOLD_WEI` | no | Defaults to `1 ether` |
| `HEDERA_RPC_URL` | for broadcast | Hedera JSON-RPC (testnet / local) |

```bash
export DEPLOYER_PRIVATE_KEY=0x...
export TEE_SIGNER=0x...
export HEDERA_RPC_URL=https://testnet.hashio.io/api

forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$HEDERA_RPC_URL" \
  --broadcast
```

**GigEscrow (MCP operator lock per post)** — set `GIG_ESCROW_ADDRESS` + existing `BUDGET_POT_ADDRESS`; operator EVM key = `PAYOUT_PRIVATE_KEY`:

```bash
export DEPLOYER_PRIVATE_KEY=0x...
export HEDERA_RPC_URL=https://testnet.hashio.io/api
# optional: export GIG_ESCROW_OPERATOR=0x…  # defaults to deployer (= payout key)

forge script script/Deploy.s.sol:DeployGigEscrow \
  --rpc-url "$HEDERA_RPC_URL" \
  --broadcast
```

Fund the pot after deploy:

```bash
cast send "$BUDGET_POT" "deposit()" --value 1ether \
  --private-key "$DEPLOYER_PRIVATE_KEY" --rpc-url "$HEDERA_RPC_URL"
```

## TeeML verdict digest

Escrow verifies EIP-191 over:

```text
inner  = keccak256(abi.encode(taskId, resultHash, true))
digest = keccak256("\x19Ethereum Signed Message:\n32" ‖ inner)
```

Off-chain 0G TeeML inference is mocked in tests; only the signer check is on-chain.

## Shared integration

Apps talk to settlement through `@proofwork/shared` `PotPort` / `EscrowPort`. This package does not wire adapters — other lanes consume ABIs from `out/` after `forge build`.
