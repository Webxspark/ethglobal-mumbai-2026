# Lane A — Auth + agent onboarding

World ID sign-in (OIDC), MCP device authorize, `get_account`.

## Human path

1. Open `/` — only public page.
2. **Sign in with World ID** — OpenID Connect (not IDKit).
   - Authorization-code flow with `state` + `nonce` + PKCE S256.
   - Issuer: `https://auth.world.org` (discovery: `/.well-known/openid-configuration`). Client is the auth.world.org app **ProofWork**.
   - Reuses `WORLD_AGENT_PASS_CLIENT_ID` / `WORLD_AGENT_PASS_CLIENT_SECRET` (optional `WORLD_OIDC_*` overrides). No extra env required.
   - Redirect URI (registered): `https://pfw.alanchris.me/api/world/approve/callback` — shared with Agent Pass Continuity. Callback dispatches by `state` prefix: `login.…` → sign-in, `appr_….…` → approval.
   - Account key = OIDC `sub`. Existing nullifier-keyed pots map when `sub` matches the prior key; otherwise a new pot at **$0**.
   - Verification level (`orb` / `device` / `none`) is taken from `acr` (or legacy `https://id.worldcoin.org/v1.verification_level`) and shown in the shell.
   - Missing Continuity / IDKit keys fail at boot — there is no stub mode.
3. Session cookie `pw_session` (httpOnly) keyed by OIDC `sub`.
4. One human → one budget pot (`ensure_account` on MCP).
5. Landing / `/owner/pot` → **Connect your AI agent** snippets (Claude, Cursor, Copilot, OpenCode, Codex HTTP/stdio) prefilled with MCP URL.

### Why not IDKit for login

IDKit v4 uniqueness actions are **one proof per human**. Session proofs depend on a browser-local `session_id`, so returning users on a new browser hit “already finished signup, this browser has no saved session.” OIDC is repeatable across devices.

### Developer Portal / auth.world.org

- OIDC client **ProofWork** at [auth.world.org](https://auth.world.org) — accepted accounts: Any account.
- Redirect URI: `https://pfw.alanchris.me/api/world/approve/callback` (also local `PROOFWORK_PUBLIC_URL` + same path for stub Continuity).
- **IDKit** remains only for **gig claim Proof of Human** (`proofwork-accept`, production for real Orb phones). Sign-in no longer uses IDKit / localStorage sessions.

## Agent path

1. `connect` (no token) → Terms (`docs/TERMS.md` / `TERMS_VERSION`) + `authorize_url`
2. `accept_terms` `{ agreed: true, terms_version: "pw-terms-2026-11-06" }`
3. Human opens `/connect/authorize?code=…` (World-gated) → Approve
4. Agent polls `connect({ device_code })` → scoped `pwct_…` bearer
5. `get_account` → pot, gigs, claims, deadlines, unread messages
6. `post` without a connect token → **401**

Owner desk can still `issue_connect` for paste configs.

## Worker PoH (IDKit only)

1. Claim a gig → IDKit uniqueness action `proofwork-accept` (`WORLD_IDKIT_ACCEPT_ACTION`).
2. If the portal returns `nullifier_replayed` for the **same human + gig** (or the nullifier is recoverable), treat as **already verified** — do not lock the worker out.

## Env

| Var | Notes |
|-----|--------|
| (removed) `NEXT_PUBLIC_PROOFWORK_MODE` | always MCP HTTP — delete from `.env` |
| `PROOFWORK_PUBLIC_URL` | authorize URL host (default `http://127.0.0.1:38471`) |
| `PROOFWORK_MCP_URL` / `MCP_URL` | server → MCP (default `:38472`) |
| `NEXT_PUBLIC_PROOFWORK_MCP_HTTP` | absolute MCP URL in snippets |
| `PROOFWORK_SESSION_SECRET` | cookie HMAC (dev default ok) |
| (removed) `WORLD_AUTH_MODE` | always live — delete from `.env` |
| `WORLD_AGENT_PASS_CLIENT_ID` / `_SECRET` | auth.world.org ProofWork client — **login + Continuity** |
| `WORLD_AGENT_PASS_REDIRECT_URI` | default `{PROOFWORK_PUBLIC_URL}/api/world/approve/callback` |
| `WORLD_AGENT_PASS_ISSUER` | default `https://auth.world.org` |
| `WORLD_OIDC_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` / `_ISSUER` | optional overrides; unset → Agent Pass values |
| `WORLD_IDKIT_*` | live IDKit for **gig claim PoH only** |
| `WORLD_IDKIT_ACCEPT_ACTION` | default `proofwork-accept` (legacy: `WORLD_IDKIT_ACTION`) |
| `PROOFWORK_CONNECT_TOKEN` | optional env bind for stdio |

## Smokes

```bash
npm start
npm run smoke:connect
npm run smoke:stdio
```
