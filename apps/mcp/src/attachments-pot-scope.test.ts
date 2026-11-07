/**
 * Real attachment bytes + bearer pot scoping for list/get.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Wei } from "@proofwork/shared";
import { invokeTool } from "./invoke.js";
import { BadRequest, NotFound } from "./tools.js";
import { bootTestRuntime } from "./test-runtime.js";

process.env.NODE_ENV = "test";
process.env.PROOFWORK_ACCOUNTS_PATH = "off";

async function fundAndMint(
  nullifier: string,
  amountWei = 10_000_000_000n,
) {
  const runtime = bootTestRuntime({
    PROOFWORK_ACCOUNTS_PATH: "off",
    PROOFWORK_PUBLIC_URL: "https://pfw.example",
  });
  const account = runtime.ports.accounts.ensureForNullifier(nullifier, {
    label: "att-scope-test",
  });
  await runtime.ports.pot.deposit({
    potId: account.potId,
    amountWei: amountWei as Wei,
    owner: account.owner,
  });
  const minted = runtime.ports.connect.mint({
    potId: account.potId,
    owner: account.owner,
    ttlSecs: 600,
    label: "att-scope",
  });
  return { ...runtime, account, minted };
}

describe("attachments store real bytes", () => {
  it("send_message persists sha256 id; get_attachment returns base64 + mime", async () => {
    const { ports, session, tools, minted } = await fundAndMint(
      "0xatt-bytes-nullifier",
    );

    const posted = await invokeTool({
      tools,
      ports,
      name: "post",
      body: {
        rewardWei: "10000",
        metadata: "bafy-att-meta",
        category: "photo_proof",
        geo: { lat: 19.076, lng: 72.877 },
      },
      headers: { Authorization: `Bearer ${minted.token}` },
      session,
    });
    const taskId = (posted.result as { taskId: string }).taskId;

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );

    const sent = await invokeTool({
      tools,
      ports,
      name: "send_message",
      body: {
        taskId,
        role: "worker",
        body: "Evidence attached",
        kind: "evidence",
        attachments: [
          {
            filename: "WhatsAppImage.jpg",
            contentType: "image/png",
            data: png.toString("base64"),
          },
        ],
      },
      headers: { Authorization: `Bearer ${minted.token}` },
      session,
    });

    const att = (sent.result as { attachments: { id: string }[] }).attachments[0];
    assert.ok(att?.id);
    assert.match(att.id, /^att_[a-f0-9]{64}$/);
    assert.doesNotMatch(att.id, /bafy-proof/);

    const got = await invokeTool({
      tools,
      ports,
      name: "get_attachment",
      body: { attachmentId: att.id, include_data: true },
      headers: { Authorization: `Bearer ${minted.token}` },
      session,
    });
    const body = got.result as {
      id: string;
      mime: string;
      contentType: string;
      dataBase64: string;
      sha256: string;
      size: number;
    };
    assert.equal(body.id, att.id);
    assert.equal(body.mime, "image/png");
    assert.equal(body.contentType, "image/png");
    assert.equal(body.sha256, att.id.slice(4));
    assert.equal(body.size, png.byteLength);
    assert.equal(body.dataBase64, png.toString("base64"));
  });

  it("get_attachment unknown id → NotFound (not a fake CID)", async () => {
    const { ports, session, tools, minted } = await fundAndMint(
      "0xatt-missing-nullifier",
    );
    await assert.rejects(
      () =>
        invokeTool({
          tools,
          ports,
          name: "get_attachment",
          body: {
            attachmentId: "bafy-proof-177d15d7-WhatsAppImag",
            include_data: true,
          },
          headers: { Authorization: `Bearer ${minted.token}` },
          session,
        }),
      (err: unknown) => err instanceof NotFound,
    );
  });
});

describe("list/get scoped to bearer pot", () => {
  it("rejects retired demo pot id", async () => {
    const { tools } = await fundAndMint("0xdemo-reject-nullifier");
    await assert.rejects(
      () =>
        tools.dispatch("list", {
          potId: "0xp0t000000000000000000000000000000000001",
        }),
      (err: unknown) => err instanceof NotFound,
    );
  });

  it("bearer list ignores / rejects foreign potId", async () => {
    const runtime = bootTestRuntime({
      PROOFWORK_ACCOUNTS_PATH: "off",
      PROOFWORK_PUBLIC_URL: "https://pfw.example",
    });
    const { ports, session, tools } = runtime;

    const accountA = ports.accounts.ensureForNullifier("0xscope-a-nullifier");
    const accountB = ports.accounts.ensureForNullifier("0xscope-b-nullifier");
    for (const account of [accountA, accountB]) {
      await ports.pot.deposit({
        potId: account.potId,
        amountWei: 10_000_000_000n as Wei,
        owner: account.owner,
      });
    }
    const tokenA = ports.connect.mint({
      potId: accountA.potId,
      owner: accountA.owner,
      ttlSecs: 600,
    }).token;
    const tokenB = ports.connect.mint({
      potId: accountB.potId,
      owner: accountB.owner,
      ttlSecs: 600,
    }).token;

    const postedA = await invokeTool({
      tools,
      ports,
      name: "post",
      body: {
        rewardWei: "10000",
        metadata: "bafy-scope-a",
        category: "shelf_check",
        geo: { lat: 19.076, lng: 72.877 },
      },
      headers: { Authorization: `Bearer ${tokenA}` },
      session,
    });
    const taskA = (postedA.result as { taskId: string }).taskId;

    const postedB = await invokeTool({
      tools,
      ports,
      name: "post",
      body: {
        rewardWei: "10000",
        metadata: "bafy-scope-b",
        category: "field_check",
        geo: { lat: 19.08, lng: 72.88 },
      },
      headers: { Authorization: `Bearer ${tokenB}` },
      session,
    });
    const taskB = (postedB.result as { taskId: string }).taskId;

    const listed = await invokeTool({
      tools,
      ports,
      name: "list",
      body: { status: ["OPEN"] },
      headers: { Authorization: `Bearer ${tokenA}` },
      session,
    });
    const rows = listed.result as { id: string; potId: string }[];
    assert.ok(rows.every((t) => t.potId === accountA.potId));
    assert.ok(rows.some((t) => t.id === taskA));
    assert.ok(!rows.some((t) => t.id === taskB));

    await assert.rejects(
      () =>
        invokeTool({
          tools,
          ports,
          name: "list",
          body: { potId: accountB.potId },
          headers: { Authorization: `Bearer ${tokenA}` },
          session,
        }),
      (err: unknown) =>
        err instanceof BadRequest &&
        /scoped to the connected bearer pot/i.test(err.message),
    );

    const got = await invokeTool({
      tools,
      ports,
      name: "get",
      body: { taskId: taskA },
      headers: { Authorization: `Bearer ${tokenA}` },
      session,
    });
    assert.equal((got.result as { id: string }).id, taskA);

    // B's task is invisible to A's bearer
    await assert.rejects(
      () =>
        invokeTool({
          tools,
          ports,
          name: "get",
          body: { taskId: taskB },
          headers: { Authorization: `Bearer ${tokenA}` },
          session,
        }),
      (err: unknown) => err instanceof NotFound,
    );
  });

  it("rejects unknown gig category on post", async () => {
    const { ports, session, tools, minted } = await fundAndMint(
      "0xcat-reject-nullifier",
    );
    await assert.rejects(
      () =>
        invokeTool({
          tools,
          ports,
          name: "post",
          body: {
            rewardWei: "10000",
            metadata: "bafy-bad-cat",
            category: "not_a_real_type",
            geo: { lat: 19.076, lng: 72.877 },
          },
          headers: { Authorization: `Bearer ${minted.token}` },
          session,
        }),
      (err: unknown) =>
        err instanceof BadRequest && /category must be one of/i.test(err.message),
    );
  });
});
