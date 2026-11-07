/**
 * Official MCP Streamable HTTP (spec 2025-06-18) + deprecated SSE fallback.
 * Mounted at /mcp (and /sse + /messages) on the Node HTTP server.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { ComposedPorts } from "@proofwork/shared/compose";
import { extractConnectToken } from "@proofwork/shared";
import {
  createProofworkMcpServer,
  type BridgeBackend,
} from "./mcp-bridge.js";
import type { ToolSession } from "./session.js";
import type { Tools } from "./tools.js";

const MAX_SESSIONS = 200;

type SessionRow = {
  transport: StreamableHTTPServerTransport | SSEServerTransport;
  kind: "streamable" | "sse";
};

export type StreamableHttpDeps = {
  tools: Tools;
  ports: ComposedPorts;
  session?: ToolSession;
};

function headerMap(
  req: IncomingMessage,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    out[k] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

function writeRpcError(
  res: ServerResponse,
  status: number,
  message: string,
  code = -32000,
) {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code, message },
      id: null,
    }),
  );
}

/** Valid connect bearer → full tool surface; missing/invalid → bootstrap only. */
function resolveSessionAuth(
  ports: ComposedPorts,
  headers: Record<string, string | undefined>,
): { token?: string; bootstrapOnly: boolean } {
  const raw = extractConnectToken(headers);
  if (!raw) return { bootstrapOnly: true };
  try {
    ports.connect.resolve(raw);
    return { token: raw, bootstrapOnly: false };
  } catch {
    // Stale bearer: still allow bootstrap so the agent can reconnect.
    return { bootstrapOnly: true };
  }
}

function buildServer(
  deps: StreamableHttpDeps,
  auth: { token?: string; bootstrapOnly: boolean },
) {
  const backend: BridgeBackend = {
    kind: "inprocess",
    tools: deps.tools,
    ports: deps.ports,
  };
  return createProofworkMcpServer(backend, {
    bootstrapOnly: auth.bootstrapOnly,
    authHeaders: () =>
      auth.token
        ? {
            authorization: `Bearer ${auth.token}`,
            "x-proofwork-connect": auth.token,
          }
        : undefined,
  });
}

/**
 * Stateful Streamable HTTP + SSE session table for one MCP process.
 */
export function createStreamableHttpHandler(deps: StreamableHttpDeps) {
  const sessions = new Map<string, SessionRow>();

  async function handleStreamable(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const sessionIdHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionIdHeader)
      ? sessionIdHeader[0]
      : sessionIdHeader;
    const existing = sessionId ? sessions.get(sessionId) : undefined;

    // GET/DELETE reuse an existing streamable session.
    if (existing) {
      if (existing.kind !== "streamable") {
        writeRpcError(
          res,
          400,
          "Bad Request: session uses a different transport",
        );
        return;
      }
      await (existing.transport as StreamableHTTPServerTransport).handleRequest(
        req,
        res,
      );
      return;
    }

    if (sessionId) {
      writeRpcError(res, 404, "Session not found", -32001);
      return;
    }

    if (req.method !== "POST") {
      writeRpcError(
        res,
        400,
        "Bad Request: No valid session ID provided",
      );
      return;
    }

    const body = await readJsonBody(req);
    if (!isInitializeRequest(body)) {
      writeRpcError(
        res,
        400,
        "Bad Request: expected initialize request",
      );
      return;
    }

    if (sessions.size >= MAX_SESSIONS) {
      writeRpcError(res, 503, "Too many open sessions");
      return;
    }

    const auth = resolveSessionAuth(deps.ports, headerMap(req));
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, { transport, kind: "streamable" });
      },
    });
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) sessions.delete(sid);
    };

    const server = buildServer(deps, auth);
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  async function handleSseGet(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (sessions.size >= MAX_SESSIONS) {
      res.writeHead(503, { "content-type": "text/plain" });
      res.end("Too many open sessions");
      return;
    }
    const auth = resolveSessionAuth(deps.ports, headerMap(req));
    // When tunnelled via Next /api/mcp/sse, clients must POST messages to
    // /api/mcp/messages — configure with PROOFWORK_PUBLIC_URL.
    const publicBase = process.env.PROOFWORK_PUBLIC_URL?.replace(/\/$/, "");
    const messagesPath = publicBase
      ? `${publicBase}/api/mcp/messages`
      : process.env.PROOFWORK_MCP_SSE_MESSAGES_PATH?.trim() || "/messages";
    const transport = new SSEServerTransport(messagesPath, res);
    sessions.set(transport.sessionId, { transport, kind: "sse" });
    transport.onclose = () => {
      sessions.delete(transport.sessionId);
    };
    const server = buildServer(deps, auth);
    await server.connect(transport);
  }

  async function handleSseMessage(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const sessionId = url.searchParams.get("sessionId") ?? "";
    const row = sessions.get(sessionId);
    if (!row || row.kind !== "sse") {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "No SSE session for sessionId",
          },
          id: null,
        }),
      );
      return;
    }
    const body = await readJsonBody(req);
    await (row.transport as SSEServerTransport).handlePostMessage(
      req,
      res,
      body,
    );
  }

  return {
    /** true if the request was handled as MCP protocol traffic. */
    async tryHandle(
      req: IncomingMessage,
      res: ServerResponse,
      url: URL,
    ): Promise<boolean> {
      const path = url.pathname.replace(/\/$/, "") || "/";

      if (path === "/mcp") {
        await handleStreamable(req, res);
        return true;
      }
      if (path === "/sse" && req.method === "GET") {
        await handleSseGet(req, res);
        return true;
      }
      if (path === "/messages" && req.method === "POST") {
        await handleSseMessage(req, res, url);
        return true;
      }
      return false;
    },
    sessionCount(): number {
      return sessions.size;
    },
    /** Close every open MCP transport (test teardown / process shutdown). */
    async close(): Promise<void> {
      const rows = [...sessions.values()];
      sessions.clear();
      await Promise.allSettled(
        rows.map(async (row) => {
          try {
            await row.transport.close();
          } catch {
            // already closed
          }
        }),
      );
    },
  };
}

export type StreamableHttpHandler = ReturnType<
  typeof createStreamableHttpHandler
>;
