/**
 * Smoke: OpenCode-style HTTP bridge sticky bearer — connect without
 * resending stale Authorization, clear on expire, pending-approve errors,
 * and expire → fresh connect → authorize → post debits pot.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";
import {
  BadRequest,
  connectRecoveryMessage,
  createHttpBridgeAuth,
  pendingApprovalMessage,
  publicConnectAuthorizeUrl,
  runHttpBridgeTool,
  type BridgeBackend,
} from "./mcp-bridge.js";
import { createHttpServer } from "./http.js";
import { bootTestRuntime, type TestMcpRuntime } from "./test-runtime.js";

process.env.NODE_ENV = "test";
process.env.PROOFWORK_ACCOUNTS_PATH = "off";
process.env.PROOFWORK_PUBLIC_URL = "https://pfw.example";

describe("HTTP bridge sticky bearer post", () => {
  let baseUrl = "";
  let backend: Extract<BridgeBackend, { kind: "http" }>;
  let runtime: TestMcpRuntime;
  let close: () => Promise<void>;
  let potId = "";
  let owner = "";

  before(async () => {
    runtime = bootTestRuntime({
      PROOFWORK_ACCOUNTS_PATH: "off",
      PROOFWORK_PUBLIC_URL: "https://pfw.example",
    });

    const ensured = (await runtime.tools.dispatch("ensure_account", {
      nullifierHash: "0xbridge-smoke-nullifier",
      label: "bridge-smoke",
    })) as { potId: string; owner: string };
    potId = ensured.potId;
    owner = ensured.owner;
    await runtime.ports.pot.deposit({
      potId,
      amountWei: 5_000_000_000n,
      owner,
    });

    const http = createHttpServer({
      tools: runtime.tools,
      ports: runtime.ports,
      port: 0,
      session: runtime.session,
    });
    const server = http.listen("127.0.0.1") as ReturnType<typeof createServer>;
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      throw new Error("expected TCP address");
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;
    backend = {
      kind: "http",
      baseUrl,
      auth: createHttpBridgeAuth(),
    };
    close = () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
  });

  after(async () => {
    if (close) await close();
  });

  it("connect → post without x_payment forwards bearer and debits pot", async () => {
    backend.auth = createHttpBridgeAuth();
    const issued = (await runHttpBridgeTool(
      backend,
      "issue_connect",
      { potId, owner, ttl_secs: 600, label: "bridge-smoke" },
      false,
    )) as { token: string; potId: string };
    assert.match(issued.token, /^pwct_/);
    assert.equal(backend.auth.connectToken, issued.token);

    backend.auth.connectToken = "pwct_stale_should_not_be_sent";

    const connected = (await runHttpBridgeTool(
      backend,
      "connect",
      { token: issued.token },
      false,
    )) as { status?: string; potId: string; token?: string };
    assert.equal(connected.status, "authorized");
    assert.equal(connected.potId, potId);
    assert.equal(backend.auth.connectToken, issued.token);

    const before = await (
      await fetch(`${baseUrl}/tools/pot_status`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${issued.token}`,
        },
        body: JSON.stringify({ potId }),
      })
    ).json() as { result: { balanceWei: string } };

    const posted = (await runHttpBridgeTool(
      backend,
      "post",
      {
        rewardWei: "50000000",
        metadata: "bafy-bridge-bearer-smoke",
        geo: { lat: 19.076, lng: 72.877 },
      },
      true,
    )) as {
      taskId: string;
      payment: { source: string; rewardHbar: string };
    };

    assert.ok(posted.taskId);
    assert.equal(posted.payment.source, "pot");

    const after = await (
      await fetch(`${baseUrl}/tools/pot_status`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${issued.token}`,
        },
        body: JSON.stringify({ potId }),
      })
    ).json() as { result: { balanceWei: string } };

    assert.equal(
      BigInt(after.result.balanceWei),
      BigInt(before.result.balanceWei) - 50_000_000n,
    );
  });

  it("connect(token='') clears sticky; stale token error tells agent to re-approve", async () => {
    backend.auth = createHttpBridgeAuth("pwct_dead_sticky");
    const boot = (await runHttpBridgeTool(
      backend,
      "connect",
      { token: "" },
      false,
    )) as { status: string; authorize_url: string; device_code: string };
    assert.equal(boot.status, "authorization_required");
    assert.equal(backend.auth.connectToken, undefined);
    assert.equal(backend.auth.pendingAuthorizeUrl, boot.authorize_url);

    backend.auth.connectToken = "pwct_definitely_expired";
    await assert.rejects(
      () =>
        runHttpBridgeTool(
          backend,
          "get_account",
          {},
          false,
        ),
      (err: unknown) => {
        assert.ok(err instanceof BadRequest);
        assert.match(err.message, /call connect/i);
        assert.match(err.message, /\/connect\/authorize/);
        assert.equal(backend.auth.connectToken, undefined);
        return true;
      },
    );
  });

  it("pending device flow: post says pending human approval at link", async () => {
    backend.auth = createHttpBridgeAuth();
    const boot = (await runHttpBridgeTool(
      backend,
      "connect",
      { label: "pending-post" },
      false,
    )) as { status: string; authorize_url: string };
    assert.equal(boot.status, "authorization_required");
    assert.ok(backend.auth.pendingAuthorizeUrl);

    await assert.rejects(
      () =>
        runHttpBridgeTool(
          backend,
          "post",
          {
            rewardWei: "10000",
            metadata: "bafy-pending",
          },
          true,
        ),
      (err: unknown) => {
        assert.ok(err instanceof BadRequest);
        assert.equal(
          err.message,
          pendingApprovalMessage(boot.authorize_url),
        );
        assert.doesNotMatch(err.message, /USDC|mock mode|X-PAYMENT/i);
        return true;
      },
    );
  });

  it("pot_status with potId survives a stale Authorization header", async () => {
    const res = await fetch(`${baseUrl}/tools/pot_status`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer pwct_stale_readonly",
      },
      body: JSON.stringify({ potId }),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      result: { balanceWei: string; id?: string };
    };
    assert.ok(json.result.balanceWei != null);
  });

  it("expire token → connect fresh → authorize → post debits pot", async () => {
    backend.auth = createHttpBridgeAuth();

    const dead = runtime.ports.connect.mint({
      potId: potId as `0x${string}`,
      owner: owner as `0x${string}`,
      ttlSecs: 60,
      label: "will-expire",
    });
    runtime.ports.connect.revoke(dead.token);
    backend.auth.connectToken = dead.token;

    await assert.rejects(
      () =>
        runHttpBridgeTool(
          backend,
          "post",
          { rewardWei: "10000", metadata: "bafy-expired" },
          true,
        ),
      (err: unknown) => {
        assert.ok(err instanceof BadRequest);
        assert.equal(
          err.message,
          connectRecoveryMessage(backend.auth.pendingAuthorizeUrl),
        );
        assert.equal(backend.auth.connectToken, undefined);
        return true;
      },
    );

    const boot = (await runHttpBridgeTool(
      backend,
      "connect",
      { label: "reauth" },
      false,
    )) as {
      status: string;
      device_code: string;
      terms_version: string;
      authorize_url: string;
    };
    assert.equal(boot.status, "authorization_required");

    await runHttpBridgeTool(
      backend,
      "accept_terms",
      {
        device_code: boot.device_code,
        agreed: true,
        terms_version: boot.terms_version,
      },
      false,
    );

    const approved = (await runHttpBridgeTool(
      backend,
      "authorize_connect",
      {
        device_code: boot.device_code,
        nullifierHash: "0xbridge-smoke-nullifier",
      },
      false,
    )) as { token: string; potId: string };
    assert.match(approved.token, /^pwct_/);

    const polled = (await runHttpBridgeTool(
      backend,
      "connect",
      { device_code: boot.device_code },
      false,
    )) as { status: string; token: string; potId: string };
    assert.equal(polled.status, "authorized");
    assert.equal(backend.auth.connectToken, polled.token);
    assert.equal(backend.auth.pendingAuthorizeUrl, undefined);

    const beforeBal = (
      await runtime.ports.pot.status(potId as `0x${string}`)
    ).balanceWei;

    const posted = (await runHttpBridgeTool(
      backend,
      "post",
      {
        rewardWei: "90000000",
        metadata: "bafy-reauth-post",
        geo: { lat: 19.07, lng: 72.87 },
      },
      true,
    )) as { taskId: string; payment: { source: string } };

    assert.ok(posted.taskId);
    assert.equal(posted.payment.source, "pot");

    const afterBal = (
      await runtime.ports.pot.status(potId as `0x${string}`)
    ).balanceWei;
    assert.equal(afterBal, beforeBal - 90_000_000n);
  });

  it("unauthenticated post points at connect/authorize (no USDC/mock)", async () => {
    const anonBackend: Extract<BridgeBackend, { kind: "http" }> = {
      kind: "http",
      baseUrl,
      auth: createHttpBridgeAuth(),
    };
    await assert.rejects(
      () =>
        runHttpBridgeTool(
          anonBackend,
          "post",
          {
            potId,
            rewardWei: "10000",
            metadata: "bafy-anon-bridge",
          },
          true,
        ),
      (err: unknown) => {
        assert.ok(err instanceof BadRequest);
        assert.match(err.message, /connected posts need Authorization/i);
        assert.match(err.message, new RegExp(publicConnectAuthorizeUrl()));
        assert.doesNotMatch(err.message, /USDC|mock/i);
        return true;
      },
    );
  });
});
