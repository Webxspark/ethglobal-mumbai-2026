/**
 * MCP smoke — health, unpaid 402, pot-funded post, cancel with x402.
 *
 *   npm run smoke -w @proofwork/mcp
 *
 * Expects a running MCP server (`npm run dev:mcp`) on MCP_URL (default 38472).
 * Prereqs: fund the session pot (ensure_account + pot_deposit), then issue_connect.
 * For cancel, send a valid X-PAYMENT (this script uses the mock gate base64 JSON shape).
 */
import {
  mockX402PaymentHeader,
  smokeEnsureFundedPot,
  smokeIssueConnect,
} from "./_smoke-helpers.js";

const base = process.env.MCP_URL ?? "http://127.0.0.1:38472";

async function main() {
  const health = await fetch(`${base}/health`).then((r) => r.json());
  console.log("health", health);

  const unpaid = await fetch(`${base}/tools/post`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      rewardWei: "10000",
      metadata: "bafy-smoke",
      geo: { lat: 19.076, lng: 72.877 },
    }),
  });
  const challenge = await unpaid.text();
  console.log("unpaid status", unpaid.status);
  if (unpaid.status !== 402) {
    throw new Error(`expected 402, got ${unpaid.status}: ${challenge}`);
  }
  console.log("402 challenge (truncated)", challenge.slice(0, 180), "…");

  const { potId, owner } = await smokeEnsureFundedPot(
    base,
    "0xsmoke-nullifier",
    5_000_000_000n,
  );

  const token = await smokeIssueConnect(base, potId, owner, 600, "smoke-mcp");

  const paid = await fetch(`${base}/tools/post`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      rewardWei: "10000",
      metadata: "bafy-smoke",
      geo: { lat: 19.076, lng: 72.877 },
    }),
  });
  const posted = (await paid.json()) as {
    result?: { taskId?: string; payment?: { source?: string } };
    error?: string;
  };
  console.log("pot-funded post", paid.status, posted);
  if (paid.status !== 200 || !posted.result?.taskId) {
    throw new Error("pot-funded post failed");
  }
  if (posted.result.payment?.source !== "pot") {
    throw new Error("expected payment.source=pot");
  }

  const list = await fetch(`${base}/tools/list`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      near: { lat: 19.076, lng: 72.877, radiusM: 5000 },
    }),
  }).then((r) => r.json());
  console.log(
    "nearby count",
    Array.isArray((list as { result?: unknown[] }).result)
      ? (list as { result: unknown[] }).result.length
      : list,
  );

  const cancel = await fetch(`${base}/tools/cancel`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...mockX402PaymentHeader(),
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ taskId: posted.result.taskId }),
  });
  console.log("cancel", cancel.status, await cancel.json());

  const audit = await fetch(`${base}/audit?limit=20`).then((r) => r.json());
  console.log(
    "audit events",
    (audit as { events?: { event: { type: string } }[] }).events?.map(
      (e) => e.event.type,
    ),
  );

  console.log("smoke ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
