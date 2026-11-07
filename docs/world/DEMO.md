# World auth demo script (Agent Pass + IDKit)

Lane: `world-auth`. Stub works without portal keys. Live path needs Developer Portal + auth.world.org app.

## Env

```bash
cp .env.example apps/web/.env.local
# leave WORLD_AUTH_MODE=stub for dry run
npm install
npm run build -w @proofwork/shared
npm test -w @proofwork/shared
npm run dev
```

App: [PROOFWORK web](http://127.0.0.1:38471)

## Stub path (no World keys)

### 1. Agent Pass — over-threshold approval

```bash
# Start Continuity-style approval (returns authorizeUrl)
curl -s -X POST http://127.0.0.1:38471/api/world/approve/start \
  -H 'content-type: application/json' \
  -d '{
    "taskId":"0xtask000000000000000000000000000000000001",
    "potId":"0xp0t000000000000000000000000000000000001",
    "amountWei":"2000000000000000000",
    "owner":"0xowner0000000000000000000000000000000001",
    "reason":"shelf audit over threshold",
    "thresholdWei":"1000000000000000000"
  }' | jq .

# Open authorizeUrl (stub callback completes Agent Pass)
# or curl the authorizeUrl directly — expect success:true
```

Denied paths (append to stub `code`):

| Suffix | Code |
|--------|------|
| `:deny` | `approval_denied` |
| `:wrong-owner` | `not_owner` |
| `:stale` | `stale_auth` |
| TTL / rewritten `expiresAt` | `approval_expired` |

MCP equivalent (forwards begin to web so callback shares the approval store):

```bash
# web on 38471 + mcp on 38472
curl -s -X POST http://127.0.0.1:38472/tools/request_approval \
  -H 'content-type: application/json' \
  -d '{"taskId":"0xtask000000000000000000000000000000000001","reason":"over threshold","amountWei":"2000000000000000000"}'
# → authorizeUrl on the web origin; open it to complete stub Agent Pass
```

### 2. IDKit — Proof of Human before accept

```bash
# RP signature for IDKit widget (worker-ui)
curl -s -X POST http://127.0.0.1:38471/api/idkit/rp-signature \
  -H 'content-type: application/json' \
  -d '{"action":"proofwork-accept"}' | jq .

# Verify + nullifier gate
curl -s -X POST http://127.0.0.1:38471/api/idkit/verify \
  -H 'content-type: application/json' \
  -d '{
    "signal":"0xworker0000000000000000000000000000000001",
    "idkitResponse":{
      "protocol_version":"4.0",
      "action":"proofwork-accept",
      "environment":"staging",
      "responses":[{
        "identifier":"proof_of_human",
        "issuer_schema_id":1,
        "nullifier":"0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8"
      }]
    }
  }' | jq .
# → { success, nullifierHash }  then EscrowPort.accept({ humanNullifier })
```

Cancel / ban:

```bash
curl -s -X POST http://127.0.0.1:38471/api/idkit/verify \
  -H 'content-type: application/json' \
  -d '{"idkitResponse":{"cancelled":true}}'
# → error: cancelled
```

## Live path

1. Register app at [auth.world.org/portal](https://auth.world.org/portal) (Agent Pass OIDC) and [developer.world.org](https://developer.world.org) (IDKit RP).
2. Set `WORLD_AUTH_MODE=live` plus client id/secret, redirect URI, `WORLD_IDKIT_*` (app_id, rp_id, signing key).
3. Restart web. `approve/start` redirects to Continuity authorize (`max_age=0`, PKCE). Callback validates JWKS ID token, `(iss,sub)`, `auth_time`.
4. Worker UI: IDKit `proofOfHuman` → `/api/idkit/verify` forwards payload to `POST /api/v4/verify/{rp_id}` unchanged.
5. Event note: proofs may use fake identities — say “World-verified flow (staging identities)” on stage.

## UI lane call sites

```ts
import { createWorldAuth, gateRequestApproval, gateWorkerAccept } from "@proofwork/shared";

const auth = createWorldAuth(process.env);
await gateRequestApproval(auth.world, { … });
const { nullifierHash } = await gateWorkerAccept(auth.human, { proof: idkitResult });
```

Or HTTP: `/api/world/approve/start`, `/api/world/approve/callback`, `/api/idkit/rp-signature`, `/api/idkit/verify`.
