/** Server-side MCP HTTP helper (Route Handlers / Server Components). */

function mcpOrigin(): string {
  return (
    process.env.PROOFWORK_MCP_URL ??
    process.env.MCP_URL ??
    "http://127.0.0.1:38472"
  ).replace(/\/$/, "");
}

export async function callMcpServerTool<T = unknown>(
  name: string,
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<{ ok: true; result: T } | { ok: false; status: number; error: string }> {
  try {
    const res = await fetch(`${mcpOrigin()}/tools/${name}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as {
      result?: T;
      error?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: json.error ?? `MCP ${name} HTTP ${res.status}`,
      };
    }
    return { ok: true, result: json.result as T };
  } catch (err) {
    return {
      ok: false,
      status: 503,
      error:
        err instanceof Error
          ? err.message
          : "MCP unreachable — start npm run dev:mcp",
    };
  }
}

export function publicMcpUrl(): string {
  if (process.env.NEXT_PUBLIC_PROOFWORK_MCP_HTTP?.trim()) {
    return process.env.NEXT_PUBLIC_PROOFWORK_MCP_HTTP.replace(/\/$/, "");
  }
  const pub = process.env.PROOFWORK_PUBLIC_URL?.replace(/\/$/, "");
  if (pub && !/127\.0\.0\.1|localhost/i.test(pub)) {
    return `${pub}/api/mcp`;
  }
  return "http://127.0.0.1:38472";
}
