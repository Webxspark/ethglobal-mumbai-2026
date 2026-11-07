import {
  mcpCorsPreflight,
  proxyToMcp,
} from "@/lib/mcp-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

/**
 * Catch-all: /api/mcp/tools/*, /api/mcp/sse, /api/mcp/messages, /health, …
 * Streams through so SSE + Streamable HTTP resumability keep working.
 */
async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  const suffix = "/" + path.map(encodeURIComponent).join("/");
  return proxyToMcp(req, suffix);
}

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  return handle(req, ctx);
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return handle(req, ctx);
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  return handle(req, ctx);
}

export async function OPTIONS(): Promise<Response> {
  return mcpCorsPreflight();
}
