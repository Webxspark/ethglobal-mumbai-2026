import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EscrowStatus, type Wei } from "@proofwork/shared";
import { invokeTool } from "./invoke.js";
import { bootTestRuntime } from "./test-runtime.js";
import {
  __resetWorkerProfilesForTests,
  bindClaimNullifier,
} from "./worker-profiles.js";

process.env.NODE_ENV = "test";
process.env.PROOFWORK_ACCOUNTS_PATH = "off";
process.env.PROOFWORK_ESCROW_PATH = "memory";
process.env.PROOFWORK_WORKER_PROFILES_PATH = "memory";

describe("gig claim — IDKit portal replay → accepted", () => {
  it("session replay ack claims an open gig after prior PoH bind", async () => {
    __resetWorkerProfilesForTests();
    const { ports, session, tools } = bootTestRuntime({
      MCP_PORT: "38472",
      PROOFWORK_PUBLIC_URL: "https://pfw.example",
      PROOFWORK_ACCOUNTS_PATH: "off",
    });

    const accountKey = "world-sub-replay-claim";
    const claimNullifier =
      "0x9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b";
    bindClaimNullifier(accountKey, claimNullifier);

    const owner = ports.accounts.ensureForNullifier("owner-replay-claim", {
      label: "owner",
    });
    await ports.pot.deposit({
      potId: owner.potId,
      amountWei: 5_000_000_000n as Wei,
      owner: owner.owner,
    });
    const minted = ports.connect.mint({
      potId: owner.potId,
      owner: owner.owner,
      ttlSecs: 600,
      label: "replay",
    });

    const posted = await invokeTool({
      tools,
      ports,
      name: "post_gig",
      body: {
        rewardWei: "5000",
        metadata: "bafy-replay-claim",
        title: "Replay claim path",
        category: "shelf_check",
        deadline_at: Math.floor(Date.now() / 1000) + 3600,
        max_work_secs: 1800,
      },
      headers: { Authorization: `Bearer ${minted.token}` },
      session,
    });
    const taskId = (posted.result as { taskId: string }).taskId;
    assert.ok(taskId);

    const accepted = (await tools.dispatch("accept", {
      taskId,
      humanNullifier: accountKey,
      proof: { replayAck: true },
    })) as { status: string };

    assert.equal(accepted.status, EscrowStatus.Accepted);
    const task = await ports.escrow.get(taskId);
    assert.equal(task.status, EscrowStatus.Accepted);
    assert.ok(task.claimedAt);
    assert.equal(task.humanNullifier, claimNullifier);
  });

  it("replay ack without prior bind uses World account key (OIDC sub)", async () => {
    __resetWorkerProfilesForTests();
    const { ports, session, tools } = bootTestRuntime({
      MCP_PORT: "38472",
      PROOFWORK_PUBLIC_URL: "https://pfw.example",
      PROOFWORK_ACCOUNTS_PATH: "off",
    });

    const accountKey = "world-oidc-sub-fresh-replay";

    const owner = ports.accounts.ensureForNullifier("owner-replay-oidc", {
      label: "owner",
    });
    await ports.pot.deposit({
      potId: owner.potId,
      amountWei: 5_000_000_000n as Wei,
      owner: owner.owner,
    });
    const minted = ports.connect.mint({
      potId: owner.potId,
      owner: owner.owner,
      ttlSecs: 600,
      label: "replay-oidc",
    });

    const posted = await invokeTool({
      tools,
      ports,
      name: "post_gig",
      body: {
        rewardWei: "5000",
        metadata: "bafy-replay-oidc",
        title: "Replay OIDC anchor",
        category: "shelf_check",
        deadline_at: Math.floor(Date.now() / 1000) + 3600,
        max_work_secs: 1800,
      },
      headers: { Authorization: `Bearer ${minted.token}` },
      session,
    });
    const taskId = (posted.result as { taskId: string }).taskId;

    const accepted = (await tools.dispatch("accept", {
      taskId,
      humanNullifier: accountKey,
      proof: { replayAck: true },
    })) as { status: string };

    assert.equal(accepted.status, EscrowStatus.Accepted);
    const task = await ports.escrow.get(taskId);
    assert.equal(task.humanNullifier, accountKey);
  });
});
