# Judge demo — 3 minutes

Cold script for ETHGlobal Mumbai. Default UI is **mock** (offline stills). Compose path uses MCP + still-mock adapters unless LIVE keys.

**Release model:** worker evidence is review input in a chat thread. The posting agent calls `all_satisfied` to release Hedera escrow. TeeML does **not** auto-pay.

## Before you talk (30s)

```bash
npm install
npm run demo:judge   # prints this script + boots MCP if needed + smoke:ui
npm run dev          # web → http://127.0.0.1:38471  (mock stills)
```

Optional compose path:

```bash
# Terminal A
npm run dev:mcp      # → :38472 (requires live keys in .env)
# Terminal B
npm run dev -w @proofwork/web
# Or one-shot: npm start   /   npm run smoke:ui
```

Open [http://127.0.0.1:38471](http://127.0.0.1:38471).

## Click path (~2.5 min)

### 0. Hub (10s)

“Give your agent a **budget**, not a card. Humans prove work; your agent releases escrow.”

### 1. Owner pot → Connect agent → Agent Pass (50s)

1. **Open pot console** → `/owner/pot`
2. Show balance, threshold, spend ledger
3. **Connect an agent** → mint `proofwork_connect` token → copy OpenCode snippet (HTTP bridge + token)
4. Tap **Approve** on the over-threshold inbox row (if seeded)
5. World **Agent Pass** sheet → **Authenticate with World** → approved

**Say:** Owner binds the agent to this pot with a short-lived token over HTTP — same MCP the Review inbox reads. Agent can encumber under the threshold; over that, World Agent Pass. Minting works in mock World; live portal keys are optional.

### 2. Worker → IDKit → evidence thread (60s)

1. Tab **Tasks** → `/worker/tasks`
2. Open a Mumbai fixture → **Accept task**
3. **Proof of Human** sheet → **Verify with World** (IDKit / nullifier)
4. Code word + **Tap to capture** → **Submit to thread**
5. Thread sheet — evidence sits as review input (not auto-pay)

**Say:** Fixed bounty, no bidding. World gates the human. Evidence is chat + attachments for the posting agent.

### 3. Agent all_satisfied → Paid (40s)

1. Back to **Owner** → `/owner/pot` **Review inbox**
2. Open the submitted task → read thread
3. Tap **all_satisfied** → Paid  
   (or **Dispute / report** → Binance-like “under review” stub)

**Say:** Only the posting agent releases BudgetPot / escrow funds. Dispute is an MVP report stub — not a second verifier. After `connect`, agent `post`s without potId (bearer binds the pot), parks on `wait_task_event` / `notify_url`; missed respond SLA auto-refunds (never auto-pays).

### 4. Nearby feed (20s)

1. Tab **Nearby** → `/feed/nearby`
2. Map + radius chips; open pins deep-link to worker
3. After PAID / DISPUTED (live MCP), pin drops from Arkiv projection

**Say:** Arkiv holds geo entities only — escrow status stays source of truth.

## Sponsor callouts (10s)

| Sponsor | Where it shows |
|---------|----------------|
| **World Agent Pass** | Owner pot over-threshold approval sheet |
| **World IDKit** | Worker accept · Proof of Human |
| **Hedera x402** | MCP `POST /tools/post` unpaid → **402**; HCS audit trail |
| **Arkiv** | `/feed/nearby` geo projection |

Hedera x402 one-liner if asked: unpaid MCP mutation returns HTTP 402; `X-PAYMENT: mock` clears the gate. Details: `docs/mcp-x402.md`.

0G TeeML may still score as **advisory** review input — it is **not** on the prize pitch and cannot release escrow alone.

## Screenshots

| Flow | Still |
|------|-------|
| Owner pot / Agent Pass | `docs/screenshots/proofwork-owner-pot.png`, `proofwork-agent-pass.png` |
| Worker / IDKit | `docs/screenshots/proofwork-worker-tasks.png`, `proofwork-idkit.png` |
| Nearby | `docs/screenshots/proofwork-nearby.png` |

## Honesty

World sheets use **staging identity** copy (no live portal keys). Mock mode for UI stills; `MODE=mcp` for compose. Full smoke: `npm run smoke:verify` (evidence → `all_satisfied` → PAID).

Longer lane notes: `docs/worker-ui-demo.md`, `docs/world/DEMO.md`, `arkiv/schema.md`.
