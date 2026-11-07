/**
 * post with submission_form → invalid submit rejected → valid accepted →
 * agent reads formResponse via get + list_task_events.
 */
import { EXAMPLE_SUBMISSION_FORM } from "@proofwork/shared";

const MCP = (process.env.PROOFWORK_MCP_URL ?? "http://127.0.0.1:38472").replace(
  /\/$/,
  "",
);

async function postTool(name: string, body: unknown = {}) {
  const res = await fetch(`${MCP}/tools/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-PAYMENT": "mock",
      ...(process.env.PROOFWORK_CONNECT_TOKEN
        ? {
            Authorization: `Bearer ${process.env.PROOFWORK_CONNECT_TOKEN}`,
          }
        : {}),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    result?: Record<string, unknown>;
    error?: string;
  };
  return { status: res.status, json };
}

async function main() {
  const health = await fetch(`${MCP}/health`);
  if (!health.ok) throw new Error(`MCP not up at ${MCP}`);

  // Ensure a connect session for paid post (smoke may already have env token).
  if (!process.env.PROOFWORK_CONNECT_TOKEN) {
    const issued = await postTool("issue_connect", {
      potId: undefined,
      label: "form-smoke",
    });
    // Soft path — compose may allow demo without connect in some modes.
    console.log("issue_connect", issued.status);
  }

  const pot = await postTool("ensure_account", {
    nullifierHash: "nullifier-form-smoke",
  });
  const potId =
    (pot.json.result as { potId?: string } | undefined)?.potId ??
    (pot.json as { potId?: string }).potId;
  if (!potId) {
    // Fall back to deposit on demo pot via pot_status listing.
    console.log("ensure_account", pot.status, pot.json);
  }

  if (potId) {
    await postTool("pot_deposit", {
      potId,
      amountWei: "500000000",
      nullifierHash: "nullifier-form-smoke",
    });
  }

  const connectTok = process.env.PROOFWORK_CONNECT_TOKEN;
  if (!connectTok && potId) {
    const issued = await postTool("issue_connect", {
      potId,
      label: "form-smoke-agent",
    });
    const token = (issued.json.result as { token?: string })?.token;
    if (token) {
      process.env.PROOFWORK_CONNECT_TOKEN = token;
      await postTool("accept_terms", {
        // may need device flow — ignore failures in mock
      }).catch(() => null);
      await postTool("connect", { token }).catch(() => null);
    }
  }

  const posted = await postTool("post_gig", {
    potId,
    rewardWei: "100000000",
    metadata: "bafy-form-smoke",
    title: "Form smoke shelf check",
    deadline_at: Math.floor(Date.now() / 1000) + 3600,
    max_work_secs: 1800,
    submission_form: EXAMPLE_SUBMISSION_FORM,
  });
  if (posted.status !== 200) {
    throw new Error(`post_gig failed: ${JSON.stringify(posted.json)}`);
  }
  const taskId = (posted.json.result as { taskId: string }).taskId;
  const form = (posted.json.result as { submissionForm?: unknown })
    .submissionForm;
  if (!form) throw new Error("post did not echo submissionForm");
  console.log("posted", taskId);

  const got = await postTool("get", { taskId });
  const gotForm = (got.json.result as { submissionForm?: { fields: unknown[] } })
    ?.submissionForm;
  if (!gotForm?.fields?.length) throw new Error("get missing submissionForm");

  await postTool("accept", {
    taskId,
    humanNullifier: "nullifier-form-smoke-worker",
  });

  const bad = await postTool("submit", {
    taskId,
    form_response: { store_name: "Only name" },
  });
  if (bad.status === 200) {
    throw new Error("expected invalid form_response to be rejected");
  }
  console.log("invalid rejected", bad.status, bad.json.error ?? bad.json);

  const up = await postTool("upload_attachment", {
    filename: "shelf.jpg",
    contentType: "image/jpeg",
    // 1x1 jpeg
    data:
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z",
  });
  if (up.status !== 200) {
    throw new Error(`upload failed: ${JSON.stringify(up.json)}`);
  }
  const attachmentId = (up.json.result as { attachmentId: string })
    .attachmentId;

  const ok = await postTool("submit", {
    taskId,
    form_response: {
      store_name: "Reliance Fresh",
      shelf_photo: { attachmentId, filename: "shelf.jpg", contentType: "image/jpeg" },
      sku_count: 8,
      condition: "clean",
      notes: "front facing ok",
      check_in: { lat: 19.076, lng: 72.877 },
    },
  });
  if (ok.status !== 200) {
    throw new Error(`valid submit failed: ${JSON.stringify(ok.json)}`);
  }
  const submitted = ok.json.result as {
    status: string;
    formResponse?: Record<string, unknown>;
    formCard?: unknown[];
  };
  if (submitted.status !== "SUBMITTED") {
    throw new Error(`expected SUBMITTED, got ${submitted.status}`);
  }
  if (!submitted.formResponse?.store_name) {
    throw new Error("submit missing formResponse");
  }
  console.log("submitted ok", submitted.formResponse.store_name);

  const again = await postTool("get", { taskId });
  const task = again.json.result as {
    formResponse?: { store_name?: string };
    status?: string;
  };
  if (task.formResponse?.store_name !== "Reliance Fresh") {
    throw new Error("get missing formResponse");
  }

  const events = await postTool("list_task_events", { taskId });
  const rows = (events.json.result as unknown[]) ?? [];
  const hit = rows.find(
    (e) =>
      e &&
      typeof e === "object" &&
      (e as { event?: string }).event === "evidence_submitted",
  ) as { payload?: { formResponse?: unknown; formCard?: unknown } } | undefined;
  if (!hit?.payload?.formResponse && !hit?.payload?.formCard) {
    console.log("events", JSON.stringify(rows).slice(0, 500));
    throw new Error("list_task_events missing form payload");
  }

  const msgs = await postTool("list_messages", { taskId });
  const list = (msgs.json.result as Array<{ kind?: string; formCard?: unknown }>) ?? [];
  if (!list.some((m) => m.kind === "form_response" && m.formCard)) {
    throw new Error("thread missing form_response card");
  }

  const att = await postTool("get_attachment", {
    attachmentId,
    include_data: true,
  });
  if (att.status !== 200) throw new Error("get_attachment failed");
  const attBody = att.json.result as { dataBase64?: string };
  if (!attBody.dataBase64) throw new Error("expected include_data bytes");

  console.log("smoke-submission-form ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
