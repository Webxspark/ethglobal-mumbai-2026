# PROOFWORK v2

ETHGlobal Mumbai. Human + agent task marketplace. Origin is the source of truth for this repo.

**Horizon:** ~36h remaining. Prefer a working demo over polish.

## Problem

Money, identity, and audit must not live in separate silos. Agents can spend past a threshold without a World Agent Pass. Workers can claim without Proof of Human. Owners can race a refund against an honest submit. PROOFWORK v2 makes **on-chain BudgetPot + Escrow the settlement source of truth**, with **HCS audit + Arkiv task entities** as the agent-facing projection for list/nearby. World, Hedera x402, 0G TeeML, and IDKit are adapters around that machine.

## Synthesis decision

Architect Phase B produced two candidates:

| Candidate | Shape | Verdict |
|-----------|-------|---------|
| A | Escrow-core + thin adapters | **Base** — one mutation path, refund race owned by contracts, stubs stay honest |
| B | Event/audit hub (HCS+Arkiv as agent truth) | Grafted — domain events, `RefundAttempted/Won/Lost`, nearby via Arkiv projection |

**Chosen shape:** Escrow-core for settlement and lifecycle. MCP/web call the same ports. HCS appends audit events; Arkiv holds geo task entities for nearby feed. Projections may lag; they must never invent balances or bypass the refund-race invariant.

## Usage (caller's view)

Amount fields (`rewardWei`, `amountWei`, `balanceWei`, …) are **tinybar** (1 HBAR = 10⁸ tinybar). MCP passes them as decimal digit strings. Hedera JSON-RPC `tx.value` is **weibar** (tinybar × 10¹⁰); convert only when verifying or sending on-chain.

### Owner — fund pot, post task

```ts
await potPort.deposit({ potId, amountWei, owner });
const task = await escrowPort.createTask({
  potId,
  rewardWei,
  verifyWindowSecs: 3600,
  metadataCid,
  agentPassProof: overThreshold ? worldPass.attestation : null,
});
```

### Worker — IDKit accept, TeeML submit

```ts
await humanPort.requireHuman({ nullifierHash, proof });
await escrowPort.accept({ taskId, worker, humanNullifier });
const verdict = await teePort.scoreSubmission({ taskId, payload });
await escrowPort.submit({ taskId, resultCid, teeVerdict: verdict.signedVerdict });
// status → SUBMITTED; verifyDeadline armed
```

### Agent — MCP tools (Hedera x402 on mutations)

```ts
tools.post({ potId, rewardWei, metadata, agentPassProof? })
tools.get({ taskId })
tools.list({ potId?, status?, near? })
tools.pot_status({ potId })
tools.request_approval({ taskId, reason })
tools.cancel({ taskId })
```

## Domain types (`packages/shared`)

```ts
type PotId = Brand<`0x${string}`, "PotId">;
type TaskId = Brand<`0x${string}`, "TaskId">;
type Wei = Brand<bigint, "Wei">;
type UnixSecs = Brand<number, "UnixSecs">;

enum EscrowStatus {
  Open = "OPEN",
  Accepted = "ACCEPTED",
  Submitted = "SUBMITTED",
  Verified = "VERIFIED",
  Paid = "PAID",
  Cancelled = "CANCELLED",
  Refunded = "REFUNDED",
}

type BudgetPot = {
  id: PotId;
  owner: Address;
  balanceWei: Wei;
  spentWei: Wei;
  agentPassThresholdWei: Wei;
};

type EscrowTask = {
  id: TaskId;
  potId: PotId;
  rewardWei: Wei;
  status: EscrowStatus;
  owner: Address;
  worker: Address | null;
  humanNullifier: string | null;
  resultCid: Cid | null;
  teeVerdictHash: `0x${string}` | null;
  verifyDeadline: UnixSecs | null; // set on SUBMITTED
  metadataCid: Cid;
  geo: { lat: number; lng: number } | null;
};
```

## Refund-race invariant

1. Owner `cancel` / `refund` may succeed only while status ∈ `{OPEN, ACCEPTED}`, **or** status is `SUBMITTED` and `block.timestamp > verifyDeadline` and still unverified (`expireRefund`).
2. Worker `submit` may succeed only from `ACCEPTED`. On success: status → `SUBMITTED`, `verifyDeadline = now + VERIFY_WINDOW`.
3. Submit and refund are mutually exclusive in the same storage transition. Exactly one wins.
4. Projections emit `RefundAttempted` then `RefundWon` | `RefundLost`. Never infer success from a failed tx alone.
5. `request_approval` never moves funds. `cancel` after `SUBMITTED` (pre-deadline) errors.

## 36h product delta

| Feature | Role |
|---------|------|
| **BudgetPot** | Owner deposits; tasks pull reward from pot |
| **Escrow SUBMITTED + verifyDeadline** | Refund race guard |
| **MCP tools** | `post`, `get`, `list`, `pot_status`, `request_approval`, `cancel` |
| **Owner pot console** | Balance, approvals inbox, cancel |
| **World Agent Pass** | Required when spend ≥ pot threshold |
| **IDKit Proof of Human** | Required on worker `accept` |
| **0G TeeML** | Offchain verdict + `ecrecover` on verify (product path, not prize pick) |
| **HCS audit** | Append-only domain events on key transitions |
| **Arkiv task entities** | Nearby / geo feed projection |

## Ports (public surface)

```ts
interface PotPort {
  deposit(i: { potId: PotId; amountWei: Wei; owner: Address }): Promise<void>;
  withdraw(i: { potId: PotId; amountWei: Wei; owner: Address }): Promise<void>;
  status(potId: PotId): Promise<BudgetPot>;
}

interface EscrowPort {
  createTask(i: CreateTaskInput): Promise<EscrowTask>;
  accept(i: { taskId: TaskId; worker: Address; humanNullifier: string }): Promise<EscrowTask>;
  submit(i: { taskId: TaskId; resultCid: Cid; teeVerdict: SignedTeeVerdict }): Promise<EscrowTask>;
  verify(i: { taskId: TaskId; owner: Address }): Promise<EscrowTask>;
  cancel(i: { taskId: TaskId; caller: Address }): Promise<EscrowTask>;
  expireRefund(i: { taskId: TaskId }): Promise<EscrowTask>;
  get(taskId: TaskId): Promise<EscrowTask>;
  list(q: TaskQuery): Promise<EscrowTask[]>;
}

interface WorldPassPort {
  assertAgentPass(i: { owner: Address; amountWei: Wei; attestation: unknown }): Promise<void>;
}

interface HumanPort {
  requireHuman(i: { nullifierHash: string; proof: unknown }): Promise<{ nullifierHash: string }>;
}

interface TeePort {
  scoreSubmission(i: { taskId: TaskId; payload: unknown }): Promise<SignedTeeVerdict>;
}

interface HcsAuditPort {
  append(event: DomainEvent): Promise<{ sequenceNumber: string }>;
}

interface ArkivPort {
  upsertTaskEntity(task: EscrowTask): Promise<void>;
  nearby(q: { lat: number; lng: number; radiusM: number }): Promise<TaskId[]>;
}

interface X402PaymentPort {
  requirePayment(i: { tool: string; payer: string }): Promise<{ receipt: string }>;
}
```

Adapter implementations live under `packages/shared/src/adapters/` and are **not** re-exported from the package root. Apps wire them only at a composition root.

## Domain events (HCS)

`PotFunded`, `TaskPosted`, `TaskAccepted`, `TaskSubmitted`, `ApprovalRequested`, `ApprovalGranted`, `CancelRequested`, `RefundAttempted`, `RefundWon`, `RefundLost`, `Verified`, `Paid`.

## Sponsor tracks

| Track | Target | How we hit it |
|-------|--------|---------------|
| World Agent Pass | $5k | Gate over-threshold pot spend / `request_approval` |
| World IDKit | $2.5k | Gate worker `accept` |
| Hedera x402 | $6.5k | Paywall MCP mutations; HCS audit on key events |
| Arkiv from-scratch | $4k | Task entity schema + nearby feed |
| 0G TeeML | product only | Verdict + ecrecover on verify — not a partner pick unless later |

## Module map

```
apps/web/                 Next.js — owner pot console, worker flows, nearby feed
apps/mcp/                 MCP server — tools + x402 middleware
packages/contracts/       BudgetPot + Escrow (SUBMITTED, verifyDeadline)
packages/shared/          types, ports, invariants, stub adapters
docs/spec/                this file
docs/AGENT-GUIDE.md       posting-agent behavior (also MCP resource `proofwork://guide`)
```

## Tradeoffs accepted

- Settlement on-chain first; Arkiv/HCS may lag.
- `SUBMITTED` locks owner refund until deadline — protects workers.
- Stubs for missing sponsor keys; refund-race tests stay real when contracts land.
- `request_approval` is an offchain inbox in v2; settlement still via `verify` / `cancel`.
- 0G is product path, not prize narrative.

## Alternatives rejected

| Alternative | Why not |
|-------------|---------|
| Offchain coordinator as SoT | Split ownership; weak escrow trust |
| Fat MCP owning task state | Two ways to mutate vs web |
| Pure event-hub with Escrow as emit-only query black box | Too much relay risk for 36h demo |
| Immediate owner refund anytime | Breaks submit fairness |

## Open questions

1. Which EVM + token for Mumbai demo deposits?
2. Default `VERIFY_WINDOW` length?
3. IDKit nullifier: per-worker global vs per-task?
4. Trusted 0G TeeML signer set for ecrecover?
5. Relay: same process as `apps/mcp` vs separate stub for Escrow logs → HCS?

## Next step

Land monorepo stubs + this plan on Origin `main`. Parallel agents fill contracts / mcp-x402 / world-auth / worker-ui behind ports.
