import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ConnectAuthError, RefundRaceError } from "@proofwork/shared";
import type { ComposedPorts } from "@proofwork/shared/compose";
import { REQUEST_HEADER } from "@proofwork/shared/compose";
import { invokeTool, PaymentRequired } from "./invoke.js";
import type { ToolSession } from "./session.js";
import { createStreamableHttpHandler } from "./streamable-http.js";
import {
  BadRequest,
  NotFound,
  TOOL_TABLE,
  type Tools,
  type ToolName,
} from "./tools.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
  "access-control-allow-headers":
    "content-type,x-payment,payment-signature,authorization,x-proofwork-connect,mcp-session-id,accept,last-event-id",
  "access-control-expose-headers": "mcp-session-id",
} as const;

function writeJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers?: Record<string, string>,
) {
  const payload = JSON.stringify(body, (_, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
  res.writeHead(status, {
    "content-type": "application/json",
    ...CORS,
    ...headers,
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BadRequest("invalid JSON");
  }
}

function headerMap(
  req: IncomingMessage,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    out[k] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}

export function createHttpServer(deps: {
  tools: Tools;
  ports: ComposedPorts;
  port: number;
  session?: ToolSession;
}) {
  const streamable = createStreamableHttpHandler({
    tools: deps.tools,
    ports: deps.ports,
    session: deps.session,
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${deps.port}`);

    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, { ...CORS });
        res.end();
        return;
      }

      // Official MCP Streamable HTTP (/mcp) + legacy SSE (/sse, /messages).
      if (await streamable.tryHandle(req, res, url)) {
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        writeJson(res, 200, {
          ok: true,
          service: "proofwork-mcp",
          tools: TOOL_TABLE.map((t) => t.name),
          backends: deps.ports.health.backends,
          projectionFailures: deps.ports.projector.failureCount(),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/tools") {
        writeJson(res, 200, {
          tools: TOOL_TABLE.map((t) => ({
            name: t.name,
            paid: t.paid,
          })),
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/audit") {
        const limit = Number(url.searchParams.get("limit") ?? 50);
        const taskId = url.searchParams.get("taskId");
        const lines = await deps.ports.hcs.readRecent(
          taskId ? Math.max(limit, 200) : limit,
        );
        const events = taskId
          ? lines.filter((l) => {
              const e = l.event as { taskId?: string };
              return e.taskId === taskId;
            })
          : lines;
        writeJson(res, 200, {
          events: taskId ? events.slice(-limit) : events,
          filter: taskId ? { taskId } : null,
        });
        return;
      }

      // Attachment bytes from disk store (optional Bearer / X-PROOFWORK-CONNECT).
      if (req.method === "GET" && url.pathname.startsWith("/attachments/")) {
        const id = decodeURIComponent(url.pathname.slice("/attachments/".length));
        if (!id) {
          writeJson(res, 400, { error: "attachment id required" });
          return;
        }
        const headers = headerMap(req);
        const token =
          headers["x-proofwork-connect"] ||
          headers["authorization"]?.replace(/^Bearer\s+/i, "") ||
          process.env.PROOFWORK_CONNECT_TOKEN ||
          "";
        if (process.env.PROOFWORK_ATTACH_REQUIRE_AUTH === "1" && !token) {
          writeJson(res, 401, { error: "attachment auth required" });
          return;
        }
        try {
          const { meta, bytes } = await deps.ports.attachments.get(id);
          res.writeHead(200, {
            ...CORS,
            "content-type": meta.contentType,
            "content-length": String(bytes.byteLength),
            "content-disposition": `inline; filename="${meta.filename.replace(/"/g, "")}"`,
            "cache-control": "private, max-age=60",
          });
          res.end(bytes);
        } catch (err) {
          writeJson(res, 404, {
            error: err instanceof Error ? err.message : "not found",
          });
        }
        return;
      }

      if (req.method === "POST" && url.pathname.startsWith("/tools/")) {
        const name = url.pathname.slice("/tools/".length) as ToolName;
        const row = TOOL_TABLE.find((t) => t.name === name);
        if (!row) {
          writeJson(res, 404, { error: "unknown tool" });
          return;
        }

        const body = await readBody(req);
        const headers = headerMap(req);
        const paymentHeader =
          headers[REQUEST_HEADER] ?? headers["x-payment"] ?? headers["X-PAYMENT"];

        try {
          const hit = await invokeTool({
            tools: deps.tools,
            ports: deps.ports,
            name,
            body,
            paymentHeader,
            headers,
            session: deps.session ?? deps.tools.session,
          });
          writeJson(
            res,
            200,
            { result: hit.result },
            hit.paymentResponse
              ? { [hit.paymentResponse.name]: hit.paymentResponse.value }
              : undefined,
          );
          return;
        } catch (err) {
          if (err instanceof PaymentRequired) {
            res.writeHead(402, {
              "content-type": "application/json",
              "payment-required": Buffer.from(err.challenge).toString("base64"),
            });
            res.end(err.challenge);
            return;
          }
          if (err instanceof ConnectAuthError) {
            writeJson(res, 401, { error: err.message });
            return;
          }
          if (err instanceof RefundRaceError) {
            writeJson(res, 409, {
              error: err.message,
              reason: err.reason,
            });
            return;
          }
          if (err instanceof BadRequest) {
            writeJson(res, 400, { error: err.message });
            return;
          }
          if (err instanceof NotFound) {
            writeJson(res, 404, { error: err.message });
            return;
          }
          throw err;
        }
      }

      writeJson(res, 404, { error: "not found" });
    } catch (err) {
      if (err instanceof BadRequest) {
        writeJson(res, 400, { error: err.message });
        return;
      }
      if (err instanceof NotFound) {
        writeJson(res, 404, { error: err.message });
        return;
      }
      if (err instanceof ConnectAuthError) {
        writeJson(res, 401, { error: err.message });
        return;
      }
      if (err instanceof RefundRaceError) {
        writeJson(res, 409, { error: err.message, reason: err.reason });
        return;
      }
      writeJson(res, 500, {
        error: err instanceof Error ? err.message : "tool failed",
      });
    }
  });

  return {
    listen(host = "0.0.0.0") {
      server.listen(deps.port, host, () => {
        console.log(`proofwork mcp on http://127.0.0.1:${deps.port}`);
        console.log(
          `tools: ${TOOL_TABLE.map((t) => `${t.name}${t.paid ? "*" : ""}`).join(", ")} (* = x402)`,
        );
        console.log(
          `payment header: ${REQUEST_HEADER} (connected post/post_gig use pot debit, not x402)`,
        );
        console.log(
          `mcp protocol: POST/GET/DELETE /mcp (Streamable HTTP) · GET /sse (legacy)`,
        );
      });
      return server;
    },
    server,
    streamable,
  };
}
