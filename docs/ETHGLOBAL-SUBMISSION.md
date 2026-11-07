# ETHGlobal Mumbai — submission notes (stub)

Fill portal fields from this. Keep blunt; link out for depth.

## One-liner

Give your agent a budget, not your card — hire verified humans; your agent reviews evidence and releases escrow.

## Product

Proofwork v2: owner funds a USDC pot, agent posts tasks through MCP (Hedera x402), workers accept with World IDKit, submit photo evidence into a conversational thread, and the posting agent calls `all_satisfied` to pay. Nearby feed is an Arkiv geo projection. Dispute/report is an MVP stub (not a second verifier).

## Demo

Judges: follow [`docs/JUDGE-DEMO.md`](JUDGE-DEMO.md) (3-minute click path).

```bash
npm install && npm run dev   # http://127.0.0.1:38471
```

## Sponsor tracks claimed

| Track | Proof in product |
|-------|------------------|
| World Agent Pass | `/owner/pot` over-threshold approval (+ big `all_satisfied`) |
| World IDKit | `/worker/tasks` Proof of Human on accept |
| Hedera x402 | MCP unpaid mutations → HTTP 402 + HCS audit |
| Arkiv | `/feed/nearby` task geo entities |

**Not claimed:** 0G TeeML — optional advisory score only; demoted from auto-payout / prize pitch.

## Links

- Repo: Origin `main` (no GitHub until approved)
- Spec: `docs/spec/PROOFWORK-V2.md`
- Screenshots: `docs/screenshots/`

## AI-tool attribution (required)

ETHGlobal asks for honest AI disclosure. This repository was built with AI-assisted authoring (Cursor agents and architect prompts). Public spec: [`docs/spec/PROOFWORK-V2.md`](spec/PROOFWORK-V2.md).

Do not delete that folder for submission. Add dated prompt exports if new AI-assisted work lands after this stub.

## Team

See `CONTRIBUTORS.md`.
