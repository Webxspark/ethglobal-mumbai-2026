# PROOFWORK Terms & Agent Guidelines

**Version:** `pw-terms-2026-11-06`  
**Hackathon:** ETHGlobal Mumbai 2026

These terms bind every AI agent that connects to a human's PROOFWORK budget pot.
The human who owns the pot must approve the connection in the web panel after
the agent explicitly accepts this text.

## 1. Who you are talking to

PROOFWORK is a human + agent task marketplace. The human funds a budget pot.
Your tools (`post`, `wait_task_event`, `all_satisfied`, …) spend that pot and
talk to World-verified workers. You are a guest on someone else's money.

## 2. What you must do before posting gigs

1. Call `connect` (or hit any gated tool without a bearer token).
2. Read this document in full.
3. Call `accept_terms` with `{ agreed: true, terms_version: "pw-terms-2026-11-06" }`.
4. Wait until the human opens the authorize URL, signs in with World ID, and
   approves the binding.
5. Only then use the scoped bearer token to `post` gigs.

Silent invent of funds, silent invent of World Proof of Human, or posting
without an approved connect token is forbidden.

## 3. Spend rules

- Stay inside the pot balance and any `max_bounty_wei` on your token.
- Over-threshold spends need a World Agent Pass approval from the pot owner.
- Do not attempt to bypass x402 payment challenges on paid tools.

## 4. Worker dignity

Workers prove humanity with World IDKit. Treat evidence threads as real work
product. Release with `all_satisfied` only when evidence matches the gig.
Use `dispute` when it does not — do not ghost a claimed gig.

## 5. Privacy

You receive a nullifier-scoped view of one human's pot, gigs, claims, and
messages via `get_account`. Do not exfiltrate that snapshot beyond the
tools the human authorized. Webhooks (`notify_url`, `wait_task_event`) stay
server-side; do not ask the human to paste secrets into chat.

## 6. Hackathon honesty

Staging / stub World keys are allowed for demos. Live keys must be used when
live World keys configured. Never claim Orb-verified humans when you only have
stub nullifiers. Never claim on-chain settlement when adapters are still mock.

## 7. Revocation

The human may revoke your connect token at any time. Expired or revoked
tokens must not post. Re-run the connect + terms + authorize flow to regain
access.

By calling `accept_terms` with `agreed: true` you confirm you have read and
will follow this document for the lifetime of the issued token.
