import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EXAMPLE_SUBMISSION_FORM, type Wei } from "@proofwork/shared";
import { invokeTool } from "./invoke.js";
import { BadRequest } from "./tools.js";
import { bootTestRuntime } from "./test-runtime.js";

process.env.NODE_ENV = "test";
process.env.PROOFWORK_ACCOUNTS_PATH = "off";
process.env.PROOFWORK_ESCROW_PATH = "memory";
process.env.PROOFWORK_WORKER_PROFILES_PATH = "memory";

describe("submission_form post → submit", () => {
  it("rejects invalid form_response and accepts a valid one", async () => {
    process.env.PROOFWORK_PUBLIC_URL = "https://pfw.example";
    const { ports, session, tools } = bootTestRuntime({
      MCP_PORT: "38472",
      PROOFWORK_PUBLIC_URL: "https://pfw.example",
      PROOFWORK_ACCOUNTS_PATH: "off",
    });

    const account = ports.accounts.ensureForNullifier("0xform-unit-owner", {
      label: "form-unit",
    });
    await ports.pot.deposit({
      potId: account.potId,
      amountWei: 10_000_000_000n as Wei,
      owner: account.owner,
    });

    const minted = ports.connect.mint({
      potId: account.potId,
      owner: account.owner,
      ttlSecs: 600,
      label: "form-unit",
    });

    const posted = await invokeTool({
      tools,
      ports,
      name: "post_gig",
      body: {
        rewardWei: "10000",
        metadata: "bafy-form-unit",
        title: "Form unit",
        category: "shelf_check",
        deadline_at: Math.floor(Date.now() / 1000) + 3600,
        max_work_secs: 1800,
        submission_form: EXAMPLE_SUBMISSION_FORM,
      },
      headers: { Authorization: `Bearer ${minted.token}` },
      session,
    });
    const taskId = (posted.result as { taskId: string }).taskId;
    assert.ok(
      (posted.result as { submissionForm?: { fields: unknown[] } })
        .submissionForm?.fields?.length,
    );

    const got = (await tools.dispatch("get", { taskId })) as {
      submissionForm?: { fields: unknown[] };
    };
    assert.ok(got.submissionForm?.fields?.length);

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

    let rejected = false;
    try {
      await tools.dispatch("submit", {
        taskId,
        form_response: { store_name: "only" },
      });
    } catch (e) {
      rejected = e instanceof BadRequest || e instanceof Error;
      assert.match(String((e as Error).message), /required|missing|form/i);
    }
    assert.equal(rejected, true);

    const up = (await tools.dispatch("upload_attachment", {
      filename: "shelf.jpg",
      contentType: "image/jpeg",
      data: Buffer.from("fake-jpeg-bytes").toString("base64"),
    })) as { attachmentId: string };
    assert.ok(up.attachmentId);
    assert.match(up.attachmentId, /^att_[a-f0-9]{64}$/);

    const ok = (await tools.dispatch("submit", {
      taskId,
      form_response: {
        store_name: "Reliance Fresh",
        shelf_photo: { attachmentId: up.attachmentId, filename: "shelf.jpg" },
        sku_count: 4,
        condition: "clean",
        check_in: { lat: 19.07, lng: 72.87 },
      },
    })) as {
      status: string;
      formResponse?: { store_name?: string };
      formCard?: unknown[];
    };
    assert.equal(ok.status, "SUBMITTED");
    assert.equal(ok.formResponse?.store_name, "Reliance Fresh");
    assert.ok(ok.formCard?.length);

    const after = (await tools.dispatch("get", { taskId })) as {
      formResponse?: { store_name?: string };
    };
    assert.equal(after.formResponse?.store_name, "Reliance Fresh");

    const events = (await tools.dispatch("list_task_events", {
      taskId,
    })) as Array<{ event: string; payload?: { formResponse?: unknown } }>;
    assert.ok(
      events.some(
        (e) => e.event === "evidence_submitted" && e.payload?.formResponse,
      ),
    );

    const msgs = (await tools.dispatch("list_messages", { taskId })) as Array<{
      kind?: string;
      formCard?: unknown[];
    }>;
    assert.ok(msgs.some((m) => m.kind === "form_response" && m.formCard));

    const att = (await tools.dispatch("get_attachment", {
      attachmentId: up.attachmentId,
      include_data: true,
    })) as { dataBase64?: string; mime?: string };
    assert.ok(att.dataBase64);
    assert.ok(att.mime);
  });
});
