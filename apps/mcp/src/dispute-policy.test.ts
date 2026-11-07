import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import {
  EscrowStatus,
  type Address,
  type Cid,
  type EscrowTask,
  type Wei,
} from "@proofwork/shared";
import { makeFixtureTask } from "../../../packages/shared/src/adapters/stubs.js";
import type { MemoryEscrow } from "@proofwork/shared/adapters/memory/escrow.js";
import { invokeTool } from "./invoke.js";
import { BadRequest } from "./tools.js";
import { bootTestRuntime } from "./test-runtime.js";

process.env.NODE_ENV = "test";
process.env.PROOFWORK_ACCOUNTS_PATH = "off";
process.env.PROOFWORK_ESCROW_PATH = "memory";

describe("dispute policy + resolve_dispute", () => {
  it("dispute blocked without prior agent message on SUBMITTED", async () => {
    const { ports, session, tools, minted } = await fundAgent();
    const taskId = await postAndSubmit(tools, ports, session, minted.token);
    await assert.rejects(
      () =>
        invokeTool({
          tools,
          ports,
          name: "dispute",
          body: { taskId, reason: "bad photo" },
          headers: { Authorization: `Bearer ${minted.token}` },
          session,
        }),
      (e: unknown) =>
        e instanceof BadRequest &&
          /message the worker about the problem first/i.test(e.message),
    );
  });

  it("request_changes moves SUBMITTED → ACCEPTED", async () => {
    const { ports, session, tools, minted } = await fundAgent();
    const taskId = await postAndSubmit(tools, ports, session, minted.token);
    const hit = await invokeTool({
      tools,
      ports,
      name: "request_changes",
      body: { taskId, message: "Please retake with code word visible" },
      headers: { Authorization: `Bearer ${minted.token}` },
      session,
    });
    const body = hit.result as { status: string };
    assert.equal(body.status, EscrowStatus.Accepted);
  });

  it("all_satisfied from DISPUTED points to resolve_dispute", async () => {
    const { ports, session, tools, minted, account } = await fundAgent();
    const escrow = ports.escrow as MemoryEscrow;
    const worker = "0x2222222222222222222222222222222222222222" as Address;
    const task = makeFixtureTask({
      id: (`0x${randomBytes(20).toString("hex")}`) as EscrowTask["id"],
      potId: account.potId,
      owner: account.owner,
      status: EscrowStatus.Disputed,
      worker,
      humanNullifier: "nf-dispute-legacy",
      resultCid: "att_legacy" as Cid,
    });
    escrow.seed(task);
    await assert.rejects(
      () =>
        invokeTool({
          tools,
          ports,
          name: "all_satisfied",
          body: { taskId: task.id },
          headers: { Authorization: `Bearer ${minted.token}` },
          session,
        }),
      (e: unknown) =>
        e instanceof BadRequest && /resolve_dispute/i.test(e.message),
    );
  });

  it("resolve_dispute reopen moves DISPUTED → OPEN", async () => {
    const { ports, session, tools, minted, account } = await fundAgent();
    const escrow = ports.escrow as MemoryEscrow;
    const workerAddr =
      "0x2222222222222222222222222222222222222222" as Address;
    const task = makeFixtureTask({
      id: (`0x${randomBytes(20).toString("hex")}`) as EscrowTask["id"],
      potId: account.potId,
      owner: account.owner,
      status: EscrowStatus.Disputed,
      worker: workerAddr,
      humanNullifier: "nf-legacy",
      resultCid: "att_fixed_photo" as Cid,
    });
    escrow.seed(task);
    const resolved = await invokeTool({
      tools,
      ports,
      name: "resolve_dispute",
      body: { taskId: task.id, outcome: "reopen" },
      headers: { Authorization: `Bearer ${minted.token}` },
      session,
    });
    const out = resolved.result as { status: string };
    assert.equal(out.status, EscrowStatus.Open);
    const live = await escrow.get(task.id);
    assert.equal(live.worker, null);
    assert.ok(live.blockedWorkers?.includes(workerAddr));
  });
});

async function fundAgent() {
  const runtime = bootTestRuntime({
    PROOFWORK_PUBLIC_URL: "https://pfw.example",
  });
  const account = runtime.ports.accounts.ensureForNullifier(
    "0xdispute-policy-owner",
    { label: "dispute-policy" },
  );
  await runtime.ports.pot.deposit({
    potId: account.potId,
    amountWei: 50_000_000_000n as Wei,
    owner: account.owner,
  });
  const minted = runtime.ports.connect.mint({
    potId: account.potId,
    owner: account.owner,
    ttlSecs: 600,
    label: "dispute-policy",
  });
  return { ...runtime, minted, account };
}

async function postAndSubmit(
  tools: ReturnType<typeof bootTestRuntime>["tools"],
  ports: ReturnType<typeof bootTestRuntime>["ports"],
  session: ReturnType<typeof bootTestRuntime>["session"],
  token: string,
) {
  const posted = await invokeTool({
    tools,
    ports,
    name: "post_gig",
    body: {
      rewardWei: "25000",
      metadata: "bafy-dispute-policy",
      title: "Dispute policy gig",
      deadline_at: Math.floor(Date.now() / 1000) + 3600,
      max_work_secs: 900,
    },
    headers: { Authorization: `Bearer ${token}` },
    session,
  });
  const taskId = (posted.result as { taskId: string }).taskId;
  await tools.dispatch("accept", {
    taskId,
    humanNullifier:
      "0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8",
    proof: {
      protocol_version: "4.0",
      action: "proofwork-accept",
      environment: "stub",
      responses: [
        {
          identifier: "proof_of_human",
          nullifier:
            "0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8",
          issuer_schema_id: 1,
        },
      ],
    },
  });
  await tools.dispatch("submit", {
    taskId,
    resultCid: "att_bad",
    skipTee: true,
  });
  return taskId;
}
