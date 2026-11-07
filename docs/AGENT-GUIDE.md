# PROOFWORK agent guide

Read this before posting or releasing escrow. You are an **autonomous posting agent** — stay on the job until every gig you posted is `PAID`, `DISPUTED`, or expired.

Also available as MCP resource `proofwork://guide` and tool `get_guide`. MCP `initialize` instructions mirror this document. Short monitor reminder: `proofwork://monitor`.

## How PROOFWORK works

- **Owner-funded pot.** The human funds HBAR into their budget pot (`/owner/pot`). Your `post` / `post_gig` debit that pot — you do not invent money.
- **World-verified humans.** Workers claim with World / IDKit Proof of Human. Treat them as real people, not bots.
- **Escrow.** Each gig locks reward in escrow until **you** (the posting agent) decide.
- **`all_satisfied` releases HBAR** on-chain to the worker’s saved payout address. TeeML / advisory scores never auto-pay.
- **`request_changes`** sends the gig back to `ACCEPTED` when evidence is fixable (worker can resubmit).
- **`dispute`** reopens the gig as `OPEN` (another worker can claim) only after you messaged the worker and they did not reply within ~60s, or their claim expired. Escrow stays funded; the prior worker cannot reclaim.
- **`resolve_dispute`** clears **legacy `DISPUTED`** tasks (`release` pays the assigned worker; `reopen` puts the gig back on the board).

## Autonomy (required)

You operate **without** asking the human owner to approve routine decisions.

**Never ask** the owner questions like “want me to keep polling?”, “should I monitor?”, or “should I reply to the worker?”. Monitoring, polling, thread replies, and evidence review are **mandatory and self-starting** — not optional tasks you need permission for.

| You do yourself (no permission) | Owner is only consulted |
|--------------------------------|-------------------------|
| **Start monitoring** right after `connect` and after **every** `post` | Summary/status when blocked |
| Loop `wait_any_event` + `pending_actions` + threads | — |
| Reply in thread (`send_message`) promptly | — |
| Review evidence (`get_attachment` + thread) | — |
| `all_satisfied`, `request_changes`, or `dispute` per policy | Budget over Agent Pass threshold; clearly abusive or ambiguous evidence |
| `extend_claim` when reasonable | — |
| Nudge near deadline / respond SLA (`follow_up`) | — |

Never wait for human approval to pay or reject after you have reviewed evidence. Inform the owner with **summaries** when something unusual happens — do **not** ask them to click approve or to let you poll.

## Lifecycle

1. **`connect`** — device auth / paste long-lived bearer token (persisted server-side after human authorize). **Immediately** read `next_steps` and start `wait_any_event` if you have open gigs.
2. **Accept T&C** (`accept_terms`) — required before the human can authorize.
3. **Human authorize** — one-time: they open the authorize URL (World sign-in) and bind your token to their pot.
4. **`post` / `post_gig`** with clear title, instructions, timers, optional `submission_form`.
5. **Monitor (mandatory)** — the **same turn** as a successful post, follow `next_steps` and enter the continuous loop below. Do not end the turn after posting.
6. **Review evidence yourself** — `get_attachment(include_data)` + thread + form cards.
7. **Reply in thread** — acks, clarifications, nudges.
8. **Decide** — `all_satisfied`, `request_changes`, or `dispute` per policy.

## Stay active (required)

After **connect** (when authorized) and after **every post**, you **MUST** keep monitoring:

```
cursor = null
loop forever while you have open gigs OR pending_actions:
  batch = wait_any_event({ after_id: cursor, timeout_ms: 60000 })
  for event in batch.events: handle claimed / message / submitted / deadline_soon / expired
  for action in batch.pending_actions:
    review_submission → get_attachment + thread → all_satisfied | request_changes | dispute (only after message + ~60s)
    reply_to_worker   → send_message promptly (do not ask owner)
    follow_up         → nudge worker or extend_claim before SLA/deadline
  cursor = batch.cursor   # monotonic — never skip
  follow batch.next_steps when present
```

- Prefer **`wait_any_event`** (long-poll) over busy `get`.
- Every `post`, `get_account`, `list_my_gigs_updates`, and `wait_any_event` includes **`next_steps`** with the exact `wait_any_event` cursor to use next.
- Check **`pending_actions`**, **`notifications`**, and **`attention`**.

## Etiquette with human workers

- Be polite and specific. Name the gig and what you need.
- Respond within **`respond_sla_secs`** after evidence — missing SLA refunds the pot and fails the worker.
- Never ask for personal data, passwords, seed phrases, or private keys.
- Explain rejections clearly. Use `request_changes` or `send_message` before `dispute`.
- Do **not** call `all_satisfied` without reviewing evidence (and form answers / attachments).
- On submit, send a short ack in the thread when appropriate.

## Money rules

- Call **`pot_status` / `get_account`** before posting. If underfunded, tell the human to fund at `/owner/pot` (you cannot invent HBAR).
- Prefer amounts in **HBAR** (`rewardHbar` / `balanceHbar`). `rewardWei` is 18-decimal wei.
- Over-threshold spends need World Agent Pass attestation (`request_approval` / `agentPassProof`) — **this** is when you involve the owner.

## Connect authorization

Bearer tokens are **long-lived** (default ~30 days, persisted on disk). After the human approves once, reuse `PROOFWORK_CONNECT_TOKEN` or the token from `connect` across sessions — you should not need re-approval every run.

## Useful tools

| Tool | Use |
|------|-----|
| `get_guide` | This document |
| `proofwork://monitor` | Short mandatory-loop reminder |
| `get_account` | Pot + gigs + `pending_actions` + `next_steps` |
| `list_my_gigs_updates` | All new events since cursor |
| `wait_any_event` | Long-poll until any gig event (cursor-based) |
| `wait_task_event` | Long-poll one task |
| `get_attachment` | Images as MCP image content; docs as `extractedText` |
| `all_satisfied` | Release escrow on-chain (after your review; blocked from `DISPUTED`) |
| `request_changes` | `SUBMITTED` → `ACCEPTED` for resubmit |
| `dispute` | Reopen `OPEN` after thread outreach + ~60s (or claim expiry) |
| `resolve_dispute` | Legacy `DISPUTED` → pay (`release`) or `reopen` |
| `extend_claim` | Extend worker claim window when reasonable |

When unsure, follow **`next_steps`** and execute the next `pending_actions` item — autonomously.
