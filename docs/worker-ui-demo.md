# worker-ui demo notes (judges)

**Cold 3-minute script:** [`JUDGE-DEMO.md`](JUDGE-DEMO.md).

Lane: `apps/web`. Ports: `@proofwork/shared` via dual-mode adapters in `src/lib/adapters/` (`mock` offline stills · `mcp` thin HTTP to compose).

## Run

```bash
npm install
npm run dev          # http://127.0.0.1:38471  (MOCK mode — offline stills)

# Live judge path (same compose as MCP):
npm run dev:mcp
NEXT_PUBLIC_PROOFWORK_MODE=mcp npm run dev
npm run smoke:ui     # optional scripted post→accept→evidence→all_satisfied→PAID
```

## Flows

### 1. Owner pot — `/owner/pot`

- Hero balance from `PotPort.status`
- **Fund pot** → `PotPort.deposit` (ledger + HCS stub event)
- **Set threshold** → updates `agentPassThresholdWei`
- **Review inbox** → thread + evidence → `EscrowPort.allSatisfied` (or `dispute` stub)
- Approvals inbox seeds one over-threshold agent post
- **Approve** opens World Agent Pass sheet → `WorldPassPort.assertAgentPass` → approval granted

### 2. Worker — `/worker/tasks`

- Browse Mumbai fixtures (fixed bounty, distance)
- **Accept** → IDKit Proof of Human sheet → `HumanPort.requireHuman` → `EscrowPort.accept`
- Code word + photo placeholder → `EscrowPort.submit` (+ optional advisory TeeML) → evidence in thread
- Wait for posting agent `all_satisfied` — no auto-pay

### 3. Nearby — `/feed/nearby`

- Map panel + radius chips
- `ArkivPort.nearby` → task entities with geo; open tasks deep-link to worker flow

## Staging honesty

World Agent Pass + IDKit use staging identity copy (no live World keys). With `NEXT_PUBLIC_PROOFWORK_MODE=mcp`, TeeML + escrow + Arkiv/HCS are the MCP compose stack (`PROOFWORK_TEE_MODE=mock|live`). Keep `MODE=mock` for offline screenshots.

## Design

apple-design motion/materials + stageshow framing on the hub still (`PitchStill`). Mobile-first PWA (`manifest.webmanifest`).

## Screenshots

Mobile stills (390×844) for judges under `docs/screenshots/`:

| File | Flow |
|------|------|
| `proofwork-hub-tall.png` | Hub + stageshow phone still |
| `proofwork-owner-pot.png` | Pot balance, approvals, spend |
| `proofwork-agent-pass.png` | World Agent Pass approval sheet |
| `proofwork-worker-tasks.png` | Worker task list |
| `proofwork-idkit.png` | IDKit Proof of Human sheet |
| `proofwork-nearby.png` | Arkiv nearby projection |
