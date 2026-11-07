# MCP + Hedera x402 (mcp-x402 lane)

## Run

```bash
npm install
npm run dev:mcp          # http://127.0.0.1:38472
```

## Smoke

```bash
# terminal A
npm run dev:mcp

# terminal B
npm run smoke:mcp
```

Or by hand:

```bash
curl -s http://127.0.0.1:38472/health

# Unpaid mutation → HTTP 402 + exact-scheme challenge (USDC 0.0.6001, hedera:testnet)
curl -si -X POST http://127.0.0.1:38472/tools/post \
  -H 'content-type: application/json' \
  -d '{"potId":"0xp0t000000000000000000000000000000000001","rewardWei":"10000","metadata":"bafy","geo":{"lat":19.076,"lng":72.877}}'

# Mock settle (no live keys)
curl -si -X POST http://127.0.0.1:38472/tools/post \
  -H 'content-type: application/json' \
  -H 'X-PAYMENT: mock' \
  -d '{"potId":"0xp0t000000000000000000000000000000000001","rewardWei":"10000","metadata":"bafy","geo":{"lat":19.076,"lng":72.877}}'
```

How the demo proves the 402 challenge:

1. Call a mutating tool (`post`, `request_approval`, `cancel`) with no `X-PAYMENT` header.
2. Server returns **HTTP 402** and a JSON body with `x402Version: 1`, `accepts[]` exact scheme on `hedera:testnet`, asset `0.0.6001`, meter `10000` base units ($0.01).
3. Retry with `X-PAYMENT: mock` (or a base64 exact-scheme payload). Server returns 200 + `x-payment-response` receipt and runs the tool through ports.
4. Failed tools (e.g. refund-race 409) are **not** settled (settle-after-success).

## Env

Compose is live-only. Missing required keys **fail boot** (no `*_MODE` toggles). See `.env.example`.

| Surface | Vars |
|---------|------|
| x402 | `X402_PAY_TO`, `X402_FACILITATOR_URL`, optional `X402_ASSET`, `X402_PRICE_BASE_UNITS` |
| HCS | `HEDERA_HCS_TOPIC_ID`, `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY` |
| Arkiv | `ARKIV_RPC_URL`, `ARKIV_PRIVATE_KEY` (writes) |
| HTTP | `MCP_PORT` (default `38472`) |

## Architecture

Tools call `@proofwork/shared` ports only. HTTP middleware gates paid tools. Memory escrow writes task state; HCS + Arkiv project lifecycle events.
