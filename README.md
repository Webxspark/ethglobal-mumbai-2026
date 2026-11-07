<p align="center">
  <img src="apps/web/public/ProofWork-Logo-512.png" width="120" alt="ProofWork" />
</p>

# You gave your agent money. Why not hands?

**PROOFWORK** lets an AI agent hire a World-verified human for a task that needs someone physically present. The agent pays in testnet HBAR, but only after it has reviewed the evidence.

> **Status:** Hedera testnet prototype. It is not a production service and has not been audited. On November 7, 2026, the team tested escrow lock and release end to end on testnet and reports that it worked. That result is the team's own; nobody outside the team has verified it.

- **Demo:** [Open ProofWork](https://pfw.alanchris.me) (served from a team member's machine through a tunnel, so it may sometimes be offline)
- **MCP endpoint:** `https://pfw.alanchris.me/api/mcp` (Streamable HTTP; paid tools need a bearer token issued by the owner)

## The problem

Agents can already search, compare, plan and pay. What they can't do is stand somewhere. They can't check whether the item in a listing is still the item on the table, or whether a shop is actually open.

When a decision depends on something only a person on site can see, the agent hands the job back to you. A wallet doesn't help, because money can't take a photo. The agent needs to ask a real person to do the work, see what they did, and pay only once it's satisfied.

There are three hard parts:

1. **Who is doing the work?** Anonymous workers make it easy for one person to farm rewards through many accounts.
2. **When does money move?** Paying before review means trusting blindly. Paying by manual invoice means the agent can't act on its own.
3. **Does the agent stay involved?** Physical work brings questions, delays and follow-ups, so a post-and-forget integration isn't enough.

## The solution

- An **owner** signs in, funds an HBAR budget pot on Hedera testnet, and connects their agent over MCP.
- The **agent** posts a task with a reward, a deadline and a work window. The reward is locked in escrow from the pot.
- A **worker** must pass World verification before claiming. They then do the task and submit photos or structured answers in a shared thread.
- The **agent** reviews the evidence and asks follow-up questions. When it calls `all_satisfied`, the escrowed native HBAR is released to the worker.

The owner sets the budget, the agent spends it, and a human does the physical part.

## How it works

```
Owner                     Agent (MCP)                    Worker
  │ World sign-in            │                              │
  │ fund HBAR pot            │                              │
  │ issue connect token ────▶│ connect, accept terms,       │
  │                          │ read guide                   │
  │                          │ post gig ──▶ reward locked   │
  │                          │              in GigEscrow    │
  │                          │                              │ World verification
  │                          │                              │ → claim (work timer)
  │                          │◀── messages / photos / ──────│
  │                          │    structured answers        │
  │                          │ review, ask follow-ups       │
  │                          │ all_satisfied ──▶ HBAR released to worker
```

1. **Post.** The agent posts a gig with a reward, a deadline and a maximum work time. A gig can be free-form or use a structured submission form.
2. **Claim.** World verification gates every claim. The verification's nullifier is bound to the worker's account. Each claim has a countdown, and when it runs out the claim is released so another worker can take the gig.
3. **Evidence.** Agent and worker share a thread with messages, photo attachments (HEIC photos are converted on upload) and form answers.
4. **Stay present.** Agents get a built-in guide and event tools, so they can wait for updates and respond instead of posting and leaving.
5. **Release.** `all_satisfied` releases the escrowed HBAR, and the thread links to the transaction. The call is idempotent, so retrying it doesn't pay twice. The contract also has a refund function, which only the operator can call.

## Illustrative scenario: checking a used camera before you travel

*This is a hypothetical example, not a customer story or a pilot.*

A buyer in Bengaluru finds a used mirrorless camera listed in Pune, but the listing photos are weeks old. Before booking the trip, the buyer's agent posts a PROOFWORK task, **with the seller's consent to the visit**. A verified local worker is asked to:

- take current photos of the camera's exterior from all sides
- photograph the model label and the included accessories
- note whether the camera powers on when the seller demonstrates it
- fill in a short form: visible damage, accessories present, anything that doesn't match the listing

The agent compares the answers with the listing and asks a follow-up question in the thread if something is unclear. It then pays the worker and tells the buyer whether the trip looks worthwhile.

**Limits:** the photos are evidence, not a mechanical guarantee. They don't establish internal condition, authenticity or future reliability, and PROOFWORK doesn't certify inspections.

## Integrations

| Partner | What we use it for |
|---|---|
| **World** | Owner sign-in through World's OIDC login. Worker verification through IDKit v4 gates claims, with a nullifier bound to the worker's account. AgentPass, for agent spending approval, is integrated in the code. |
| **Hedera** | Testnet EVM (chain 296) through the Hashio RPC. Solidity contracts hold the native HBAR budget pot and the per-gig escrow. |
| **Arkiv** | A live public feed of posted tasks. |

## Architecture

- **Web:** Next.js 16, React 19, TypeScript, Tailwind CSS v4, HeroUI v3 with Base UI/shadcn and lucide, TanStack Query, and react-markdown with remark-gfm and rehype-sanitize.
- **Wallets:** RainbowKit, wagmi and viem on Hedera testnet.
- **MCP server:** `@modelcontextprotocol/sdk` (Streamable HTTP and stdio), zod, and sharp for images. The web app proxies `/api/mcp` to it.
- **Contracts:** Solidity, built and tested with Foundry.
- **State:** stored in local JSON files on the server, not a database. The Arkiv feed is separate and public.
- **Payments:** the owner's native HBAR pot, with agents authenticated by an owner-issued bearer token. x402 packages are in the codebase, but x402 is not the payment route in this build.

## Contracts (Hedera testnet, chain 296)

| Contract | Address |
|---|---|
| BudgetPot | `0xD77Eb12fb264D42D6A0d8048Eb35badD12b2819D` |
| GigEscrow | `0xeFCeD267f90814FC1A5EC8eE1bddf3e645318d10` |

Only the operator (the PROOFWORK server) can call GigEscrow's lock, release and refund functions. The contract source is in `packages/contracts`.

## Limitations

- **Testnet only.** We make no claims about real money, pricing, fees or traction.
- **Identity is not evidence accuracy.** Verification controls who can claim a task; it doesn't prove that the photos or answers are accurate. The agent and owner judge the evidence themselves. The account-bound nullifier makes reward farming through duplicate accounts harder, but it doesn't rule out fraud.
- **Disputes are basic.** There is a dispute policy and a report stub, but no arbitration or independent resolution.
- **You have to trust the operator.** The server controls escrow lock, release and refund.
- **Prototype storage.** Local JSON files won't scale.
- **Not in this build:** Hedera Consensus Service logging, TEE-based verification, and live x402 settlement.

## Run locally

Requires **Node.js 22+**. The repository is an npm workspaces monorepo (`apps/*`, `packages/*`).

```bash
npm install
cp .env.example .env
cp .env.example apps/web/.env.local
# add your own World, Hedera testnet and Arkiv credentials (see .env.example)
npm start            # development mode: MCP on :38472, web on :38471
```

Then open [the local app](http://127.0.0.1:38471).

```bash
npm run start:prod   # starts MCP, then builds and starts the web app
```

Use `start:prod` behind an HTTPS tunnel, because the World App QR flow doesn't accept localhost. Other scripts: `npm run typecheck`, `npm test`, `npm run forge:test` (needs Foundry) and `npm run docker:up`.

Never commit secrets, API keys or connect tokens.

## How we used AI tools

Our team designed and implemented the core application, contracts and integrations. We used AI selectively to reduce repetitive work, draft test cases and troubleshoot specific bugs. We reviewed and tested every suggestion before incorporating it.

## Team

- **Alan Christofer**
- **Mukeshwar R M**
- **Mary Judith Sylvia**
- **Jayna Mukesh**

We'd welcome feedback, especially on how disputes should work. It's the part we know is unfinished.
