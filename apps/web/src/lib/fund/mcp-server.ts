/** Server-side MCP tool call (no "use client"). */

function mcpUrl(): string {
  return (
    process.env.PROOFWORK_MCP_URL ??
    process.env.MCP_URL ??
    "http://127.0.0.1:38472"
  ).replace(/\/$/, "");
}

export async function callMcpToolServer<T = unknown>(
  name: string,
  body: unknown = {},
): Promise<T> {
  const res = await fetch(`${mcpUrl()}/tools/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body, (_, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
  });
  const txt = await res.text();
  let json: unknown = {};
  try {
    json = txt ? JSON.parse(txt) : {};
  } catch {
    json = { error: txt };
  }
  if (!res.ok) {
    const msg =
      typeof json === "object" &&
      json &&
      "error" in json &&
      typeof (json as { error: unknown }).error === "string"
        ? (json as { error: string }).error
        : `MCP HTTP ${res.status}`;
    throw new Error(msg);
  }
  const envelope = json as { result?: T };
  return (envelope.result ?? json) as T;
}
