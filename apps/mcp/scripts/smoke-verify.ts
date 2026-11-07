/**
 * Release smoke — post → accept → evidence → all_satisfied / dispute / SLA paths.
 *
 *   npm run smoke:verify -w @proofwork/mcp
 *
 * Requires funded pot + bearer. Uses mock x402 base64 JSON for paid calls that need it.
 */
import {
  mockX402PaymentHeader,
  smokeEnsureFundedPot,
  smokeIssueConnect,
  stubIdKitProof,
} from "./_smoke-helpers.js";

const base = process.env.MCP_URL ?? "http://127.0.0.1:38472";

let connectToken: string | null = null;

async function postTool(
  name: string,
  body: unknown,
  opts: { paid?: boolean } = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const paid = Boolean(opts.paid);
  const res = await fetch(`${base}/tools/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(paid ? mockX402PaymentHeader() : {}),
      ...(connectToken ? { Authorization: `Bearer ${connectToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

async function main() {
  const health = await fetch(`${base}/health`).then((r) => r.json());
  console.log("health", health);

  const { potId, owner } = await smokeEnsureFundedPot(
    base,
    "0xverify-main-nullifier",
    20_000_000_000n,
  );

  connectToken = await smokeIssueConnect(base, potId, owner, 900, "smoke-verify");

  const now = Math.floor(Date.now() / 1000);
  const workerAddr = "0x2222222222222222222222222222222222222222";

  const paid = await postTool(
    "post",
    {
      rewardWei: "25000000",
      metadata: "bafy-verify-smoke",
      geo: { lat: 19.076, lng: 72.877 },
      deadline_at: now + 3600,
      max_work_secs: 1800,
      category: "shelf_check",
      tags: ["smoke"],
      title: "Verify smoke gig",
    },
    { paid: false },
  );
  console.log("post", paid.status, paid.json);
  if (paid.status !== 200) throw new Error("post failed");
  const taskId = (paid.json.result as { taskId: string }).taskId;

  const nearOpen = await postTool("list", {
    near: { lat: 19.076, lng: 72.877, radiusM: 5000 },
    status: ["OPEN"],
  });
  const nearRows = (nearOpen.json.result as unknown[]) ?? [];
  console.log("nearby OPEN", nearRows.length);
  if (!nearRows.some((t) => (t as { id: string }).id === taskId)) {
    throw new Error("Arkiv nearby missing freshly posted task");
  }

  const accepted = await postTool("accept", {
    taskId,
    worker: workerAddr,
    humanNullifier: "nullifier-smoke-verify",
    proof: {
      ...stubIdKitProof(),
      nullifier_hash: "nullifier-smoke-verify",
    },
  });
  console.log("accept", accepted.status, accepted.json);
  if (accepted.status !== 200) throw new Error("accept failed");

  const submitted = await postTool("submit", {
    taskId,
    resultCid: "bafy-photo-codeword-smoke",
    note: "Shelf photo + MUMBAI code word",
  });
  console.log("submit", submitted.status, submitted.json);
  if (submitted.status !== 200) throw new Error("submit failed");

  const thread = await postTool("thread_list", { taskId });
  const msgs = (thread.json.result as unknown[]) ?? [];
  console.log("thread msgs", msgs.length);
  if (msgs.length < 1) throw new Error("expected evidence in thread");

  const legacy = await postTool("verify", { taskId });
  if (legacy.status === 200) {
    throw new Error("verify must not succeed — demoted path expected");
  }
  console.log("verify demoted", legacy.status);

  await postTool("thread_post", {
    taskId,
    role: "agent",
    body: "Photo looks clean. Releasing.",
  });

  await postTool("worker_set_payout", {
    userId: "nullifier-smoke-verify",
    payoutAddress: "0x3333333333333333333333333333333333333333",
  });

  const released = await postTool("all_satisfied", {
    taskId,
    note: "looks good",
  });
  console.log("all_satisfied", released.status, released.json);
  const hasPayoutKey = Boolean(
    process.env.PAYOUT_PRIVATE_KEY?.trim() ||
      process.env.HEDERA_OPERATOR_EVM_KEY?.trim(),
  );
  if (!hasPayoutKey) {
    if (released.status === 200) {
      throw new Error("all_satisfied must not fake PAID without PAYOUT_PRIVATE_KEY");
    }
    console.log("payout gated without key — skipping PAID/Arkiv drop asserts");
  } else {
    if (released.status !== 200) throw new Error("all_satisfied failed");
    const status = (released.json.result as { status: string }).status;
    if (status !== "PAID") throw new Error(`expected PAID, got ${status}`);
    const nearAfter = await postTool("list", {
      near: { lat: 19.076, lng: 72.877, radiusM: 5000 },
    });
    const stillListed = (
      (nearAfter.json.result as { id: string }[]) ?? []
    ).some((t) => t.id === taskId);
    if (stillListed) throw new Error("Arkiv should drop PAID tasks from nearby");
  }

  const audit = await fetch(
    `${base}/audit?taskId=${encodeURIComponent(taskId)}&limit=20`,
  ).then((r) => r.json());
  const types = (
    (audit as { events?: { event: { type: string } }[] }).events ?? []
  ).map((e) => e.event.type);
  console.log("HCS lifecycle", types);
  const expected = hasPayoutKey
    ? [
        "TaskPosted",
        "TaskAccepted",
        "TaskSubmitted",
        "AgentSatisfied",
        "Paid",
      ]
    : ["TaskPosted", "TaskAccepted", "TaskSubmitted"];
  for (const t of expected) {
    if (!types.includes(t)) throw new Error(`audit missing ${t}`);
  }

  const dPost = await postTool(
    "post",
    {
      rewardWei: "10000000",
      metadata: "bafy-dispute-smoke",
      geo: { lat: 19.08, lng: 72.88 },
      deadline_at: now + 3600,
      max_work_secs: 900,
    },
    { paid: false },
  );
  const dId = (dPost.json.result as { taskId: string }).taskId;
  await postTool("accept", {
    taskId: dId,
    worker: workerAddr,
    humanNullifier: "nullifier-dispute",
    proof: { ...stubIdKitProof(), nullifier_hash: "nullifier-dispute" },
  });
  await postTool("submit", { taskId: dId, resultCid: "bafy-bad-photo" });
  const blocked = await postTool("dispute", {
    taskId: dId,
    reason: "code word not visible",
  });
  if (blocked.status === 200) {
    throw new Error("dispute should be blocked before messaging worker");
  }
  const changes = await postTool("request_changes", {
    taskId: dId,
    message: "Please reshoot with the code word visible",
  });
  if (changes.status !== 200) throw new Error("request_changes failed");
  const cStatus = (changes.json.result as { status: string }).status;
  if (cStatus !== "ACCEPTED") {
    throw new Error(`expected ACCEPTED after request_changes, got ${cStatus}`);
  }
  console.log("request_changes", cStatus);

  const ttlPost = await postTool(
    "post_gig",
    {
      rewardWei: "5000000",
      metadata: "bafy-ttl-smoke",
      geo: { lat: 19.07, lng: 72.87 },
      deadline_at: now + 1,
      max_work_secs: 600,
    },
    { paid: false },
  );
  if (ttlPost.status !== 200) throw new Error("ttl post failed");
  const ttlId = (ttlPost.json.result as { taskId: string }).taskId;
  await new Promise((r) => setTimeout(r, 1100));
  const lateClaim = await postTool("accept", {
    taskId: ttlId,
    worker: workerAddr,
    humanNullifier: "nullifier-ttl",
    proof: { ...stubIdKitProof(), nullifier_hash: "nullifier-ttl" },
  });
  if (lateClaim.status === 200) {
    throw new Error("accept must fail after deadline expiry");
  }
  const ttlGet = await postTool("get", { taskId: ttlId });
  const ttlStatus = (ttlGet.json.result as { status: string }).status;
  if (ttlStatus !== "EXPIRED") {
    throw new Error(`expected EXPIRED after deadline, got ${ttlStatus}`);
  }

  const claimPost = await postTool(
    "post_gig",
    {
      rewardWei: "5000000",
      metadata: "bafy-claim-smoke",
      geo: { lat: 19.072, lng: 72.872 },
      deadline_at: now + 3600,
      max_work_secs: 1,
    },
    { paid: false },
  );
  if (claimPost.status !== 200) throw new Error("claim-window post failed");
  const claimId = (claimPost.json.result as { taskId: string }).taskId;
  await postTool("accept", {
    taskId: claimId,
    worker: workerAddr,
    humanNullifier: "nullifier-claim-window",
    proof: { ...stubIdKitProof(), nullifier_hash: "nullifier-claim-window" },
  });
  await new Promise((r) => setTimeout(r, 1100));
  const afterClaim = await postTool("get", { taskId: claimId });
  const afterClaimTask = afterClaim.json.result as {
    status: string;
    worker: string | null;
    blockedWorkers?: string[];
  };
  if (afterClaimTask.status !== "OPEN" || afterClaimTask.worker != null) {
    throw new Error(
      `expected OPEN unclaim after max_work_secs, got ${JSON.stringify(afterClaimTask)}`,
    );
  }
  if (!afterClaimTask.blockedWorkers?.includes(workerAddr)) {
    throw new Error("expected worker blocked after missed claim");
  }
  const reclaim = await postTool("accept", {
    taskId: claimId,
    worker: workerAddr,
    humanNullifier: "nullifier-reclaim",
    proof: { ...stubIdKitProof(), nullifier_hash: "nullifier-reclaim" },
  });
  if (reclaim.status === 200) {
    throw new Error("blocked worker must not reclaim");
  }

  const chat = await postTool("send_message", {
    taskId,
    role: "agent",
    body: "zoom the endcap please",
    attachments: [
      {
        filename: "note.txt",
        contentType: "text/plain",
        data: Buffer.from("nudge").toString("base64"),
      },
    ],
  });
  if (chat.status !== 200) throw new Error("send_message failed");
  const chatAtt = (
    chat.json.result as { attachments: { id: string }[] }
  ).attachments?.[0]?.id;
  if (!chatAtt) throw new Error("expected attachment id");
  const gotAtt = await postTool("get_attachment", {
    attachmentId: chatAtt,
    include_data: true,
  });
  if (gotAtt.status !== 200) throw new Error("get_attachment failed");

  const slaPost = await postTool(
    "post",
    {
      rewardWei: "5000000",
      metadata: "bafy-sla-smoke",
      geo: { lat: 19.071, lng: 72.871 },
      deadline_at: now + 3600,
      max_work_secs: 900,
      respond_sla_secs: 1,
    },
    { paid: false },
  );
  const slaId = (slaPost.json.result as { taskId: string }).taskId;
  await postTool("accept", {
    taskId: slaId,
    worker: workerAddr,
    humanNullifier: "nullifier-sla",
    proof: { ...stubIdKitProof(), nullifier_hash: "nullifier-sla" },
  });
  await postTool("submit", {
    taskId: slaId,
    resultCid: "bafy-sla-ev",
  });
  await new Promise((r) => setTimeout(r, 1100));
  const slaGet = await postTool("get", { taskId: slaId });
  const slaStatus = (slaGet.json.result as { status: string }).status;
  if (slaStatus !== "EXPIRED_SLA") {
    throw new Error(`expected EXPIRED_SLA, got ${slaStatus}`);
  }

  const waited = await postTool("wait_task_event", {
    taskId: slaId,
    timeout_ms: 500,
  });
  if (waited.status !== 200) throw new Error("wait_task_event failed");

  console.log("smoke-verify ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
