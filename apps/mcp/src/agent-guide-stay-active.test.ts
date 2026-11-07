import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TaskId, Wei } from "@proofwork/shared";
import { agentGuideUri, loadAgentGuide } from "./agent-guide.js";
import { invokeTool } from "./invoke.js";
import { createProofworkMcpServer } from "./mcp-bridge.js";
import { bootTestRuntime } from "./test-runtime.js";

process.env.NODE_ENV = "test";
process.env.PROOFWORK_ACCOUNTS_PATH = "off";
process.env.PROOFWORK_ESCROW_PATH = "memory";
process.env.PROOFWORK_WORKER_PROFILES_PATH = "memory";

describe("agent guide + stay-active", () => {
  it("loads AGENT-GUIDE.md for get_guide and MCP bootstrap", async () => {
    const md = loadAgentGuide();
    assert.match(md, /How PROOFWORK works/);
    assert.match(md, /Stay active|Stay autonomous/);
    assert.match(md, /Autonomy/);
    assert.match(md, /Never ask/i);
    assert.match(md, /next_steps/i);
    assert.match(md, /wait_any_event/);
    assert.match(md, /HBAR/);
    assert.match(md, /all_satisfied/);

    const { ports, tools } = bootTestRuntime({ MCP_PORT: "38481" });
    const guide = (await tools.dispatch("get_guide", {})) as {
      uri: string;
      markdown: string;
    };
    assert.equal(guide.uri, agentGuideUri());
    assert.equal(guide.markdown, md);

    createProofworkMcpServer({ kind: "inprocess", ports, tools });
  });

  it("never loses events after cursor; pending_actions populated on submit", async () => {
    const { ports, session, tools } = bootTestRuntime({
      MCP_PORT: "38482",
      PROOFWORK_PUBLIC_URL: "https://pfw.example",
    });

    const account = ports.accounts.ensureForNullifier(
      "0xstay-active-owner-nullifier",
      { label: "stay-active" },
    );
    await ports.pot.deposit({
      potId: account.potId,
      amountWei: 10_000_000_000_000_000_000n as Wei,
      owner: account.owner,
    });
    const potId = account.potId;

    const minted = ports.connect.mint({
      potId,
      owner: account.owner,
      ttlSecs: 600,
      label: "stay-active",
    });
    const auth = { Authorization: `Bearer ${minted.token}` };

    const posted = await invokeTool({
      tools,
      ports,
      name: "post_gig",
      body: {
        rewardWei: "25000",
        metadata: "bafy-stay-active",
        title: "Shelf check Andheri",
        category: "shelf_check",
        deadline_at: Math.floor(Date.now() / 1000) + 3600,
        max_work_secs: 1800,
        respond_sla_secs: 900,
      },
      headers: auth,
      session,
    });
    const taskId = (posted.result as { taskId: string }).taskId;
    assert.ok(taskId);
    const postedBody = posted.result as {
      next_steps?: { instruction: string; cursor: string | null };
    };
    assert.ok(postedBody.next_steps);
    assert.match(postedBody.next_steps!.instruction, /Start monitoring now/i);
    assert.match(postedBody.next_steps!.instruction, /Never ask the owner/i);

    const seed = (await tools.dispatch("list_my_gigs_updates", {
      potId,
    })) as {
      events: Array<{ id: string; event: string; taskId: string }>;
      cursor: string | null;
      openGigCount: number;
      unreadCount: number;
      pending_actions: Array<{ kind: string; action: string }>;
      notifications?: Array<{ kind: string }>;
      next_steps?: { instruction: string };
      attention?: string;
    };
    assert.ok(seed.openGigCount >= 1);
    assert.ok(seed.next_steps?.instruction?.includes("wait_any_event"));
    assert.ok(seed.attention);
    const cursor0 = seed.cursor;

    const workerNf =
      "0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8";
    await tools.dispatch("accept", {
      taskId,
      humanNullifier: workerNf,
      proof: {
        protocol_version: "4.0",
        action: "proofwork-accept",
        environment: "stub",
        responses: [
          {
            identifier: "proof_of_human",
            nullifier: workerNf,
            issuer_schema_id: 1,
          },
        ],
      },
    });

    const afterClaim = (await tools.dispatch("list_my_gigs_updates", {
      potId,
      after_id: cursor0 ?? undefined,
    })) as {
      events: Array<{ id: string; event: string }>;
      cursor: string | null;
      unreadCount: number;
    };
    assert.ok(afterClaim.events.some((e) => e.event === "claimed"));
    const cursor1 = afterClaim.cursor;
    assert.ok(cursor1);
    assert.ok(afterClaim.events.every((e) => !cursor0 || e.id > cursor0));

    await tools.dispatch("submit", {
      taskId,
      resultCid: "bafy-evidence-stay",
      skipTee: true,
    });

    const afterSubmit = (await tools.dispatch("list_my_gigs_updates", {
      potId,
      after_id: cursor1,
    })) as {
      events: Array<{ id: string; event: string }>;
      cursor: string | null;
      pending_actions: Array<{ kind: string; action: string; taskId: string }>;
      notifications?: Array<{ kind: string }>;
      unreadCount: number;
      attention?: string;
    };
    assert.ok(afterSubmit.events.some((e) => e.event === "submitted"));
    assert.ok(
      afterSubmit.pending_actions.some((a) => a.kind === "review_submission"),
      JSON.stringify(afterSubmit.pending_actions),
    );
    assert.ok(
      afterSubmit.notifications?.some((n) => n.kind === "review_submission"),
    );
    assert.ok(afterSubmit.attention);

    const full = (await tools.dispatch("list_my_gigs_updates", {
      potId,
    })) as { events: Array<{ id: string }> };
    const seen = new Set<string>();
    let cur: string | null = null;
    for (let i = 0; i < 8; i++) {
      const batch = (await tools.dispatch("list_my_gigs_updates", {
        potId,
        after_id: cur ?? undefined,
      })) as {
        events: Array<{ id: string }>;
        cursor: string | null;
      };
      for (const e of batch.events) seen.add(e.id);
      if (!batch.events.length) break;
      cur = batch.cursor;
    }
    assert.deepEqual(
      [...seen].sort(),
      full.events.map((e) => e.id).sort(),
    );

    const accountView = (await tools.dispatch("get_account", { potId })) as {
      pending_actions: Array<{ kind: string; action: string }>;
      notifications?: Array<{ kind: string }>;
      openGigCount: number;
      stayActiveTip: string | null;
      attention?: string;
    };
    assert.ok(
      accountView.pending_actions.some(
        (a) =>
          a.kind === "review_submission" &&
          /Shelf check Andheri/i.test(a.action),
      ),
      JSON.stringify(accountView.pending_actions),
    );
    assert.ok(accountView.openGigCount >= 1);
    assert.ok(accountView.stayActiveTip);
    assert.ok(accountView.attention);

    const waiting = tools.dispatch("wait_any_event", {
      potId,
      after_id: afterSubmit.cursor,
      timeout_ms: 2_000,
    });
    await ports.notify.emit({
      taskId: taskId as TaskId,
      event: "message",
      payload: { from: "worker" },
    });
    const woke = (await waiting) as {
      events: Array<{ id: string; event: string }>;
      cursor: string | null;
      timedOut: boolean;
      unreadCount: number;
    };
    assert.equal(woke.timedOut, false);
    assert.ok(woke.events.some((e) => e.event === "message"));
    assert.ok(
      woke.events.every((e) => e.id > (afterSubmit.cursor ?? "")),
    );
  });
});
