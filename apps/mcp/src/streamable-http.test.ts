/**
 * SDK client → Next-style /api/mcp proxy → MCP /mcp
 * initialize + tools/list (bootstrap vs bearer).
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpServer } from "./http.js";
import { bootTestRuntime } from "./test-runtime.js";

process.env.NODE_ENV = "test";
process.env.PROOFWORK_ACCOUNTS_PATH = "off";
process.env.PROOFWORK_PUBLIC_URL = "https://pfw.example";

describe("Streamable HTTP MCP via /api/mcp proxy", () => {
  let mcpBase = "";
  let proxyBase = "";
  let mcpServer: ReturnType<typeof createServer> | undefined;
  let proxyServer: ReturnType<typeof createServer> | undefined;
  let closeStreamable: (() => Promise<void>) | undefined;
  let connectToken = "";

  before(async () => {
    const runtime = bootTestRuntime({
      PROOFWORK_ACCOUNTS_PATH: "off",
      PROOFWORK_PUBLIC_URL: "https://pfw.example",
    });

    const ensured = (await runtime.tools.dispatch("ensure_account", {
      nullifierHash: "0xstreamable-http-nullifier",
      label: "streamable",
    })) as { potId: string; owner: string };

    await runtime.ports.pot.deposit({
      potId: ensured.potId,
      amountWei: 10_000_000_000n,
      owner: ensured.owner,
    });

    const issued = runtime.ports.connect.mint({
      potId: ensured.potId as `0x${string}`,
      owner: ensured.owner as `0x${string}`,
      ttlSecs: 600,
      label: "streamable-test",
    });
    connectToken = issued.token;

    const http = createHttpServer({
      tools: runtime.tools,
      ports: runtime.ports,
      port: 0,
      session: runtime.session,
    });
    closeStreamable = () => http.streamable.close();
    mcpServer = http.listen("127.0.0.1") as ReturnType<typeof createServer>;
    await new Promise<void>((r) => mcpServer!.once("listening", r));
    const mcpAddr = mcpServer.address();
    if (!mcpAddr || typeof mcpAddr === "string") {
      throw new Error("expected TCP address");
    }
    mcpBase = `http://127.0.0.1:${mcpAddr.port}`;

    proxyServer = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const path = url.pathname.replace(/\/$/, "") || "/";
      let upstreamPath = path;
      if (path === "/" || path === "/api/mcp") {
        upstreamPath = "/mcp";
      } else if (path.startsWith("/api/mcp/")) {
        upstreamPath = path.slice("/api/mcp".length);
      }
      const target = `${mcpBase}${upstreamPath}${url.search}`;
      const headers: Record<string, string> = {};
      for (const name of [
        "content-type",
        "authorization",
        "x-proofwork-connect",
        "mcp-session-id",
        "accept",
        "last-event-id",
      ]) {
        const v = req.headers[name];
        if (typeof v === "string") headers[name] = v;
      }
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(Buffer.from(c));
      const upstream = await fetch(target, {
        method: req.method,
        headers,
        body:
          req.method === "GET" || req.method === "HEAD"
            ? undefined
            : Buffer.concat(chunks),
      });
      res.writeHead(upstream.status, {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "mcp-session-id": upstream.headers.get("mcp-session-id") ?? "",
      });
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.end(buf);
    });
    await new Promise<void>((r) => {
      proxyServer!.listen(0, "127.0.0.1", () => r());
    });
    const proxyAddr = proxyServer.address();
    if (!proxyAddr || typeof proxyAddr === "string") {
      throw new Error("expected proxy TCP address");
    }
    proxyBase = `http://127.0.0.1:${proxyAddr.port}/api/mcp`;
  });

  after(async () => {
    if (closeStreamable) await closeStreamable();
    for (const s of [proxyServer, mcpServer]) {
      if (!s) continue;
      s.unref();
      await new Promise<void>((resolve) => {
        s.close(() => resolve());
        setTimeout(resolve, 50);
      });
    }
  });

  it("initialize + tools/list through the Next-style proxy (bootstrap)", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(proxyBase));
    const client = new Client({ name: "proofwork-test", version: "0.0.1" });
    await client.connect(transport);
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    assert.ok(names.includes("health"));
    assert.ok(names.includes("connect"));
    assert.ok(names.includes("accept_terms"));
    assert.ok(names.includes("issue_connect"));
    assert.ok(names.includes("get_guide"));
    assert.ok(!names.includes("post"), "post hidden without bearer");
    assert.ok(!names.includes("get_account"));
    const resources = await client.listResources();
    assert.ok(
      resources.resources.some((r) => r.uri === "proofwork://guide"),
    );
    await client.close();
  });

  it("initialize + tools/list with Authorization shows full surface", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(proxyBase), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${connectToken}`,
        },
      },
    });
    const client = new Client({ name: "proofwork-test-auth", version: "0.0.1" });
    await client.connect(transport);
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name);
    assert.ok(names.includes("post"));
    assert.ok(names.includes("get_account"));
    assert.ok(names.includes("wait_any_event"));
    assert.ok(names.includes("list_my_gigs_updates"));
    assert.ok(names.includes("pot_status"));
    assert.ok(names.includes("health"));
    await client.close();
  });

  it("GET /mcp without session is not a silent HTML 404 JSON not-found", async () => {
    const res = await fetch(proxyBase, { method: "GET" });
    assert.notEqual(res.status, 404);
    const text = await res.text();
    assert.doesNotMatch(text, /"error"\s*:\s*"not found"/i);
  });
});
