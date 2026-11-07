import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Wei } from "@proofwork/shared";
import { PaymentRequired, invokeTool } from "./invoke.js";
import {
  BadRequest,
  NotFound,
  createTools,
  formatHbar,
  potUnderfundedMessage,
} from "./tools.js";
import { bootTestRuntime } from "./test-runtime.js";

process.env.NODE_ENV = "test";

// Keep unit tests off the shared .data disk stores unless a test opts in.
process.env.PROOFWORK_ACCOUNTS_PATH = "off";

async function fundPot(
  ports: ReturnType<typeof bootTestRuntime>["ports"],
  nullifier: string,
  amountWei: bigint,
) {
  const account = ports.accounts.ensureForNullifier(nullifier, {
    label: "invoke-pot-post-test",
  });
  await ports.pot.deposit({
    potId: account.potId,
    amountWei: amountWei as Wei,
    owner: account.owner,
  });
  return account;
}

describe("formatHbar", () => {
  it("renders whole and fractional HBAR", () => {
    assert.equal(formatHbar(0n), "0");
    assert.equal(formatHbar(100_000_000n), "1");
    assert.equal(formatHbar(150_000_000n), "1.5");
    assert.equal(formatHbar(10000n), "0.0001");
  });
});

describe("bearer post funds from pot (no x402)", () => {
  it("posts without X-PAYMENT and debits the pot", async () => {
    process.env.PROOFWORK_PUBLIC_URL = "https://pfw.example";
    const { ports, session, tools } = bootTestRuntime({
      MCP_PORT: "38472",
      PROOFWORK_PUBLIC_URL: "https://pfw.example",
    });

    const { potId, owner } = await fundPot(
      ports,
      "0xbearer-post-nullifier",
      10_000_000_000n,
    );

    const minted = ports.connect.mint({
      potId,
      owner,
      ttlSecs: 600,
      label: "unit",
    });

    const before = await ports.pot.status(minted.potId);
    const rewardWei = "10000";

    const hit = await invokeTool({
      tools,
      ports,
      name: "post",
      body: {
        rewardWei,
        metadata: "bafy-pot-funded",
        geo: { lat: 19.076, lng: 72.877 },
      },
      headers: { Authorization: `Bearer ${minted.token}` },
      session,
    });

    const result = hit.result as {
      taskId: string;
      payment: { source: string; rewardHbar: string };
    };
    assert.ok(result.taskId);
    assert.equal(result.payment.source, "pot");
    assert.equal(hit.paymentResponse, undefined);

    const after = await ports.pot.status(minted.potId);
    assert.equal(after.balanceWei, before.balanceWei - BigInt(rewardWei));

    const got = (await tools.dispatch("get", {
      taskId: result.taskId,
    })) as { id: string; status: string };
    assert.equal(got.id, result.taskId);

    const listed = (await tools.dispatch("list", {
      status: ["OPEN"],
    })) as { id: string }[];
    assert.ok(listed.some((t) => t.id === result.taskId));

    const account = (await invokeTool({
      tools,
      ports,
      name: "get_account",
      body: {},
      headers: { Authorization: `Bearer ${minted.token}` },
      session,
    })).result as { gigs: { taskId: string }[] };
    assert.ok(account.gigs.some((g) => g.taskId === result.taskId));

    const events = (await tools.dispatch("list_task_events", {
      taskId: result.taskId,
    })) as { event: string }[];
    assert.ok(events.some((e) => e.event === "posted"));
  });

  it("rejects underfunded post with fund link (no mock-mode advice)", async () => {
    process.env.PROOFWORK_PUBLIC_URL = "https://pfw.example";
    const { ports, session, tools } = bootTestRuntime({
      MCP_PORT: "38472",
      PROOFWORK_PUBLIC_URL: "https://pfw.example",
    });

    const { potId, owner } = await fundPot(
      ports,
      "0xunderfund-nullifier",
      100n,
    );

    const minted = ports.connect.mint({
      potId,
      owner,
      ttlSecs: 600,
    });

    const pot = await ports.pot.status(minted.potId);
    if (pot.balanceWei > 0n) {
      await ports.pot.withdraw({
        potId: minted.potId,
        amountWei: pot.balanceWei,
        owner: pot.owner,
      });
    }

    await assert.rejects(
      () =>
        invokeTool({
          tools,
          ports,
          name: "post_gig",
          body: {
            rewardWei: "100000000",
            metadata: "bafy-broke",
            deadline_at: Math.floor(Date.now() / 1000) + 3600,
            max_work_secs: 1800,
          },
          headers: { Authorization: `Bearer ${minted.token}` },
          session,
        }),
      (err: unknown) => {
        assert.ok(err instanceof BadRequest);
        assert.equal(err.message, potUnderfundedMessage(0n));
        assert.match(err.message, /Pot balance 0 HBAR/);
        assert.match(err.message, /https:\/\/pfw\.example\/owner\/pot/);
        return true;
      },
    );
  });

  it("still 402s anonymous post without payment (x402 path)", async () => {
    const { ports, session, tools } = bootTestRuntime({ MCP_PORT: "38472" });

    await fundPot(ports, "0xanon-post-nullifier", 1_000_000_000n);

    await assert.rejects(
      () =>
        invokeTool({
          tools,
          ports,
          name: "post",
          body: {
            rewardWei: "10000",
            metadata: "bafy-anon",
          },
          headers: {},
          session,
        }),
      (err: unknown) => {
        assert.ok(err instanceof PaymentRequired);
        const body = JSON.parse(err.challenge) as { error: string };
        assert.equal(body.error, "X-PAYMENT header is required");
        return true;
      },
    );
  });
});

describe("pot_status lazy ensure", () => {
  it("creates a missing World pot at 0 HBAR when nullifierHash is sent", async () => {
    const { ports, session, tools } = bootTestRuntime({ MCP_PORT: "38472" });
    const nullifier = "0xoidc-sub-fresh-user";

    const ensured = (await tools.dispatch("ensure_account", {
      nullifierHash: nullifier,
    })) as { potId: string };
    const status = (await tools.dispatch("pot_status", {
      potId: ensured.potId,
      nullifierHash: nullifier,
    })) as { id: string; balanceWei: bigint; balanceHbar: string };

    assert.equal(status.id, ensured.potId);
    assert.equal(status.balanceWei, 0n);
    assert.equal(status.balanceHbar, "0 HBAR");
  });

  it("returns NotFound for unknown pot without nullifier", async () => {
    const { ports, session, tools } = bootTestRuntime({ MCP_PORT: "38472" });

    await assert.rejects(
      () =>
        tools.dispatch("pot_status", {
          potId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        }),
      (err: unknown) => {
        assert.ok(err instanceof NotFound);
        assert.equal(err.message, "Unknown pot");
        return true;
      },
    );
  });
});

describe("bearer post survives MCP restart", () => {
  it("task still get/list-able after re-creating ports from .data", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pw-escrow-"));
    const prev = {
      accounts: process.env.PROOFWORK_ACCOUNTS_PATH,
      escrow: process.env.PROOFWORK_ESCROW_PATH,
      tokens: process.env.PROOFWORK_CONNECT_TOKENS_PATH,
      repairs: process.env.PROOFWORK_REPAIRS_PATH,
    };
    process.env.PROOFWORK_ACCOUNTS_PATH = join(dir, "accounts.json");
    process.env.PROOFWORK_ESCROW_PATH = join(dir, "escrow-tasks.json");
    process.env.PROOFWORK_CONNECT_TOKENS_PATH = join(dir, "tokens.json");
    process.env.PROOFWORK_REPAIRS_PATH = "off";
    process.env.PROOFWORK_PUBLIC_URL = "https://pfw.example";

    try {
      const r1 = bootTestRuntime({ MCP_PORT: "38472" });
      const session1 = r1.session;
      const tools1 = r1.tools;

      const { potId, owner } = await fundPot(
        r1.ports,
        "0xpersist-restart-human",
        100_000_000_000n,
      );

      const minted = r1.ports.connect.mint({
        potId,
        owner,
        ttlSecs: 600,
      });

      const hit = await invokeTool({
        tools: tools1,
        ports: r1.ports,
        name: "post",
        body: {
          rewardWei: "90000000",
          metadata: "bafy-restart",
          geo: { lat: 19.08, lng: 72.88 },
          title: "survives reboot",
        },
        headers: { Authorization: `Bearer ${minted.token}` },
        session: session1,
      });
      const taskId = (hit.result as { taskId: string }).taskId;

      const r2 = bootTestRuntime({ MCP_PORT: "38472" });
      const tools2 = r2.tools;
      const got = (await tools2.dispatch("get", { taskId })) as {
        id: string;
        title: string | null;
      };
      assert.equal(got.id, taskId);
      assert.equal(got.title, "survives reboot");
      const listed = (await tools2.dispatch("list", {
        status: ["OPEN"],
      })) as { id: string }[];
      assert.ok(listed.some((t) => t.id === taskId));
    } finally {
      process.env.PROOFWORK_ACCOUNTS_PATH = prev.accounts;
      process.env.PROOFWORK_ESCROW_PATH = prev.escrow;
      process.env.PROOFWORK_CONNECT_TOKENS_PATH = prev.tokens;
      process.env.PROOFWORK_REPAIRS_PATH = prev.repairs;
    }
  });
});
