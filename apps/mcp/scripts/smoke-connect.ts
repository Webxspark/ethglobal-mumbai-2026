/**
 * Connect onboarding smoke (expects live MCP on MCP_URL).
 */
import { smokeEnsureFundedPot } from "./_smoke-helpers.js";

const base = (process.env.MCP_URL ?? "http://127.0.0.1:38472").replace(
  /\/$/,
  "",
);

async function postTool(
  name: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const res = await fetch(`${base}/tools/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

async function main() {
  const health = await fetch(`${base}/health`);
  if (!health.ok) throw new Error(`MCP not up at ${base}`);

  const { potId, owner } = await smokeEnsureFundedPot(
    base,
    "0xsmoke-connect-nullifier-a",
    1_000_000_000n,
  );

  const issued = await postTool("issue_connect", {
    potId,
    owner,
    ttl_secs: 600,
    label: "smoke-connect",
    max_bounty_wei: "1000000",
  });
  if (issued.status !== 200) {
    throw new Error(`issue_connect failed: ${JSON.stringify(issued.json)}`);
  }
  const token = (issued.json as { result: { token: string } }).result.token;
  if (!token?.startsWith("pwct_")) throw new Error("bad token shape");
  console.log("issued", token.slice(0, 18) + "…");

  const barePost = await postTool(
    "post",
    { rewardWei: "10000", metadata: "bafy-no-auth" },
    {},
  );
  if (barePost.status !== 401) {
    throw new Error(
      `expected 401 for post without connect, got ${barePost.status}`,
    );
  }
  console.log("post sans token → 401 ok");

  const bad = await postTool(
    "post",
    { rewardWei: "10000", metadata: "bafy-bad" },
    { Authorization: "Bearer pwct_definitely_not_real" },
  );
  if (bad.status !== 401) {
    throw new Error(`expected 401 for bad token, got ${bad.status}`);
  }
  console.log("bad token → 401 ok");

  const connected = await postTool(
    "connect",
    { token },
    { Authorization: `Bearer ${token}` },
  );
  if (connected.status !== 200) {
    throw new Error(`connect failed: ${JSON.stringify(connected.json)}`);
  }
  const boundPotId = (connected.json as { result: { potId: string } }).result
    .potId;
  console.log("connected pot", boundPotId);

  const now = Math.floor(Date.now() / 1000);
  const posted = await postTool(
    "post",
    {
      rewardWei: "10000",
      metadata: "bafy-connect-smoke",
      geo: { lat: 19.076, lng: 72.877 },
      deadline_at: now + 3600,
      max_work_secs: 1800,
    },
    {
      Authorization: `Bearer ${token}`,
      "X-PROOFWORK-CONNECT": token,
    },
  );
  if (posted.status !== 200) {
    throw new Error(`post without potId failed: ${JSON.stringify(posted.json)}`);
  }
  const task = (
    posted.json as { result: { taskId: string; status: string } }
  ).result;
  if (!task.taskId) throw new Error("missing taskId");

  const got = await postTool("get", { taskId: task.taskId });
  const taskPot = (got.json as { result: { potId: string } }).result.potId;
  if (taskPot !== boundPotId) {
    throw new Error(`task pot ${taskPot} != bound ${boundPotId}`);
  }

  const boot = await postTool("connect", {});
  if (boot.status !== 200) {
    throw new Error(`connect boot failed: ${JSON.stringify(boot.json)}`);
  }
  const bootRes = (
    boot.json as {
      result: {
        status: string;
        device_code: string;
        terms_version: string;
        authorize_url: string;
      };
    }
  ).result;
  if (bootRes.status !== "authorization_required") {
    throw new Error(`expected authorization_required, got ${bootRes.status}`);
  }
  if (!bootRes.terms_version || !bootRes.authorize_url) {
    throw new Error("missing terms / authorize_url");
  }
  console.log("device", bootRes.device_code.slice(0, 14) + "…");

  const terms = await postTool("accept_terms", {
    device_code: bootRes.device_code,
    agreed: true,
    terms_version: bootRes.terms_version,
  });
  if (terms.status !== 200) {
    throw new Error(`accept_terms failed: ${JSON.stringify(terms.json)}`);
  }

  const authz = await postTool("authorize_connect", {
    device_code: bootRes.device_code,
    nullifierHash: "0xsmoke-device-nullifier-b",
  });
  if (authz.status !== 200) {
    throw new Error(`authorize_connect failed: ${JSON.stringify(authz.json)}`);
  }
  const deviceToken = (authz.json as { result: { token: string } }).result
    .token;

  const polled = await postTool("connect", {
    device_code: bootRes.device_code,
  });
  if (polled.status !== 200) {
    throw new Error(`poll connect failed: ${JSON.stringify(polled.json)}`);
  }
  const pollRes = (polled.json as { result: { status: string; token: string } })
    .result;
  if (pollRes.status !== "authorized" || pollRes.token !== deviceToken) {
    throw new Error("device poll did not return authorized token");
  }

  const account = await postTool(
    "get_account",
    {},
    { Authorization: `Bearer ${deviceToken}` },
  );
  if (account.status !== 200) {
    throw new Error(`get_account failed: ${JSON.stringify(account.json)}`);
  }
  const acct = (
    account.json as {
      result: { pot: { potId: string }; gigs: unknown[]; unreadCount: number };
    }
  ).result;
  if (!acct.pot?.potId) throw new Error("get_account missing pot");
  console.log(
    "get_account pot",
    acct.pot.potId.slice(0, 12) + "…",
    "gigs",
    acct.gigs.length,
  );

  console.log("smoke:connect ok", task.taskId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
