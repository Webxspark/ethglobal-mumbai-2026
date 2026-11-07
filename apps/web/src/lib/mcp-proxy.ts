/**
 * Streaming reverse proxy → MCP upstream.
 * Used by /api/mcp (Streamable HTTP) and /api/mcp/* (tools + SSE).
 */

export const MCP_PROXY_FORWARD_HEADERS = [
  "content-type",
  "authorization",
  "x-proofwork-connect",
  "x-payment",
  "payment-signature",
  "mcp-session-id",
  "accept",
  "last-event-id",
] as const;

export const MCP_PROXY_RESPONSE_HEADERS = [
  "content-type",
  "mcp-session-id",
  "cache-control",
  "x-payment-response",
  "payment-required",
] as const;

export function mcpUpstreamOrigin(): string {
  return (
    process.env.PROOFWORK_MCP_URL ??
    process.env.MCP_URL ??
    "http://127.0.0.1:38472"
  ).replace(/\/$/, "");
}

export function pickRequestHeaders(src: Headers): Headers {
  const out = new Headers();
  for (const name of MCP_PROXY_FORWARD_HEADERS) {
    const value = src.get(name);
    if (value) out.set(name, value);
  }
  return out;
}

export function pickResponseHeaders(src: Headers): Headers {
  const out = new Headers();
  for (const name of MCP_PROXY_RESPONSE_HEADERS) {
    const value = src.get(name);
    if (value) out.set(name, value);
  }
  out.set("access-control-allow-origin", "*");
  out.set(
    "access-control-allow-methods",
    "GET,POST,DELETE,OPTIONS",
  );
  out.set(
    "access-control-allow-headers",
    "Content-Type, Authorization, X-PROOFWORK-CONNECT, X-PAYMENT, Mcp-Session-Id, Accept, Last-Event-ID",
  );
  out.set("access-control-expose-headers", "Mcp-Session-Id");
  return out;
}

export function mcpCorsPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
      "access-control-allow-headers":
        "Content-Type, Authorization, X-PROOFWORK-CONNECT, X-PAYMENT, Mcp-Session-Id, Accept, Last-Event-ID",
      "access-control-expose-headers": "Mcp-Session-Id",
      "access-control-max-age": "86400",
    },
  });
}

/**
 * Proxy `req` to `${upstream}${upstreamPath}${search}` without buffering the body
 * (required for Streamable HTTP SSE streams).
 */
export async function proxyToMcp(
  req: Request,
  upstreamPath: string,
): Promise<Response> {
  const url = new URL(req.url);
  const target = `${mcpUpstreamOrigin()}${upstreamPath}${url.search}`;
  const headers = pickRequestHeaders(req.headers);

  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers,
    redirect: "manual",
  };

  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    // Stream the body through when possible.
    init.body = req.body;
    init.duplex = "half";
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    return Response.json(
      {
        error:
          err instanceof Error ? err.message : "MCP upstream unreachable",
      },
      { status: 502 },
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: pickResponseHeaders(upstream.headers),
  });
}
