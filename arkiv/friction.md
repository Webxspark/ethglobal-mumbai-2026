# Arkiv friction

Notes from wiring Rabdi TaskFeed for the geo/nearby projection — what the code actually does and what broke in practice.

## Boot and writes

- MCP compose **requires** `ARKIV_RPC_URL`. There is no mock Arkiv in production compose.
- **Reads** (nearby, `findKey`) use the public RPC client only.
- **Writes** (projector upserts after post/accept/submit/paid) need `ARKIV_PRIVATE_KEY` with funded tGLM. Without a key, `upsertTaskEntity` throws; projector records the failure in `failures[]` but escrow/HCS still commit.
- RPC calls are wrapped in a **20s timeout** (`ARKIV_LIVE_TIMEOUT_MS`) — Rabdi sometimes stalls without rejecting.

## Query limits and paging

Arkiv nodes cap page size at **`MAX_LIMIT` (100)** from `@arkiv-network/sdk/query`.

`nearby()` uses `mergeArkivPages` (`packages/shared/src/adapters/arkiv/page.ts`):

- Each page request uses `limit ≤ 100`.
- Stops when the node returns a short page or **`ARKIV_FETCH_CAP` (500)** unique `taskId` rows are collected (deduped).
- Offset advances by `entities.length + skipped` per page (honors node `skipped` counts).

Implication: dense metros may not return every pin in one query — judges see the nearest **up to 500** deduped entities inside the bounding box, then haversine-filtered to the requested radius.

## Live seeding / freshness

- Every feed-visible transition is **projector-driven** after escrow emits domain events — not a one-shot seed script.
- `expiresAt` on the entity is `verifyDeadline ?? expiresAt ?? createdAt + 86_400`.
- Upsert path: `findKey` (query `taskId`, limit 1) → `patchEntity` + `extendEntity`, or `createEntity` with expiration aligned to `expiresAt`.
- Terminal states drop the pin by upserting with `geo: null`, which **deletes** the on-chain entity.
- Bounding-box prefilter can include tasks outside the circle; exact distance is applied client-side only.

## Tests

Unit tests use `createMockArkiv` (in-memory map + optional `generation`). Page helper tests assert limits above `MAX_LIMIT` throw and multi-page merge dedupes correctly.

Schema reference: `arkiv/schema.md`.
