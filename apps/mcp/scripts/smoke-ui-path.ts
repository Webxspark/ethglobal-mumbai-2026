/**
 * UI path smoke (expects live MCP + optional web).
 */
import {
  mockX402PaymentHeader,
  smokeEnsureFundedPot,
  smokeIssueConnect,
  stubIdKitProof,
} from "./_smoke-helpers.js";

const base = process.env.MCP_URL ?? "http://127.0.0.1:38472";
const web = process.env.PROOFWORK_PUBLIC_URL ?? "http://127.0.0.1:38471";

let connectToken: string | null = null;

async function postTool(
  name: string,
  body: unknown,
  paid = false,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}/tools/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(paid ? mockX402PaymentHeader() : {}),
      ...(connectToken
        ? { Authorization: `Bearer ${connectToken}` }
        : {}),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

async function main() {
  const health = await fetch(`${base}/health`).then((r) => r.json());
  console.log("mcp health", health);

  const { potId, owner } = await smokeEnsureFundedPot(
    base,
    "0xui-smoke-human",
    50_000_000_000n,
  );

  connectToken = await smokeIssueConnect(base, potId, owner, 900, "smoke-ui");

  const now = Math.floor(Date.now() / 1000);
  const posted = await postTool(
    "post_gig",
    {
      rewardWei: "50000000",
      metadata: "bafy-hours-colaba",
      geo: { lat: 18.922, lng: 72.8347 },
      deadline_at: now + 7200,
      max_work_secs: 1800,
      category: "hours_check",
      title: "Store hours board",
      poster_agent: "demo-agent",
    },
    false,
  );
  if (posted.status !== 200) {
    throw new Error(`post failed: ${JSON.stringify(posted.json)}`);
  }
  const taskId = (posted.json.result as { taskId: string }).taskId;

  const listed = await postTool("list", {
    near: { lat: 19.076, lng: 72.877, radiusM: 40000 },
    status: ["OPEN"],
  });
  const near = (listed.json.result as { id: string }[]) ?? [];
  if (!near.some((t) => t.id === taskId)) {
    throw new Error("nearby missing posted task");
  }

  const accepted = await postTool("accept", {
    taskId,
    humanNullifier: "nullifier-ui-smoke",
    proof: { ...stubIdKitProof(), nullifier_hash: "nullifier-ui-smoke" },
  });
  if (accepted.status !== 200) throw new Error("accept failed");

  // Evidence: real bytes on disk (att_ id) — never a synthetic bafy-proof CID.
  const tinyJpeg =
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z";
  const evidence = await postTool("send_message", {
    taskId,
    role: "worker",
    body: "Hours board photo for Colaba",
    kind: "evidence",
    attachments: [
      {
        filename: "colaba-hours.jpg",
        contentType: "image/jpeg",
        data: tinyJpeg,
      },
    ],
  });
  if (evidence.status !== 200) throw new Error("send_message evidence failed");

  await postTool("thread_post", {
    taskId,
    role: "owner",
    body: "Can you zoom the hours board a bit?",
  });
  await postTool("thread_post", {
    taskId,
    role: "worker",
    body: "Cropped — code word still in frame.",
  });

  await postTool("worker_set_payout", {
    userId: "nullifier-ui-smoke",
    payoutAddress: "0x3333333333333333333333333333333333333333",
  });

  const released = await postTool("all_satisfied", {
    taskId,
    note: "hours match listing",
  });
  const hasPayoutKey = Boolean(
    process.env.PAYOUT_PRIVATE_KEY?.trim() ||
      process.env.HEDERA_OPERATOR_EVM_KEY?.trim(),
  );
  if (!hasPayoutKey) {
    if (released.status === 200) {
      throw new Error("all_satisfied must not fake PAID without PAYOUT_PRIVATE_KEY");
    }
  } else {
    if (released.status !== 200) throw new Error("all_satisfied failed");
    const result = released.json.result as { status: string };
    if (result.status !== "PAID") throw new Error(`expected PAID, got ${result.status}`);
  }

  try {
    const webRes = await fetch(web, { signal: AbortSignal.timeout(2000) });
    console.log("web", web, webRes.status);
  } catch {
    console.log("web not up (optional)");
  }

  console.log("smoke-ui-path ok", taskId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
