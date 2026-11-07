# Arkiv schema (TaskFeed)

## Named schema: `proofwork.taskfeed`

Defined in `packages/shared/src/adapters/arkiv/live.ts` via `@arkiv-network/sdk/schema`.

| Field | SDK type | Indexed | Role |
|-------|----------|---------|------|
| `taskId` | `str` | yes | Escrow task id (logical key) |
| `lat` | `dec` | yes | Latitude for bbox + nearby |
| `lng` | `dec` | yes | Longitude for bbox + nearby |
| `potId` | `str` | yes | Owner pot filter |
| `expiresAt` | `u64` | yes | Unix seconds; rows past expiry are skipped in `nearby` |

On-chain entities also carry Arkiv `$key` (entity address). The adapter caches `taskId → $key` for patch/delete within one MCP process.

**Not stored on Arkiv:** task status (`OPEN`, `ACCEPTED`, `SUBMITTED`, `PAID`, …). Escrow is source of truth; `list` / UI join `arkiv.nearby()` ids with `escrow.get`.

## Nearby query behavior

1. Indexed bounding box on `lat` / `lng` (from query radius).
2. Pages through results (see `arkiv/friction.md`).
3. Client-side: drop expired rows, haversine distance filter, sort by distance.

## Projector lifecycle

| Domain event | Arkiv action |
|--------------|--------------|
| `TaskPosted`, `TaskAccepted`, `TaskSubmitted`, `Verified`, `AgentSatisfied` | `upsertTaskEntity` with geo + `expiresAt` |
| `Paid`, `RefundWon`, `TaskDisputed`, `TaskExpired`, `SlaBreached` | Clear geo → live **deletes** entity; mock removes from map |

Judges: post a geo task → `list` with `near` → accept/submit and watch the pin → terminal event → pin gone. Audit: `GET /audit?taskId=` (HCS).

## Env (live compose)

| Var | Required |
|-----|----------|
| `ARKIV_RPC_URL` | yes (boot fails if missing); Rabdi URL may embed `/ark_…` access key |
| `ARKIV_PRIVATE_KEY` | writes only (`createEntity` / `patchEntity` / `deleteEntity`); reads work with RPC alone |

Compose is live-only for Arkiv (no mode toggle).
