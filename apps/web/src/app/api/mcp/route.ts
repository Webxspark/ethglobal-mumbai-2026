import {
  mcpCorsPreflight,
  proxyToMcp,
} from "@/lib/mcp-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Official MCP Streamable HTTP endpoint (spec 2025-06-18).
 * Proxies https://…/api/mcp → MCP :38472/mcp (Authorization + Mcp-Session-Id).
 */
export async function GET(req: Request): Promise<Response> {
  return proxyToMcp(req, "/mcp");
}

export async function POST(req: Request): Promise<Response> {
  return proxyToMcp(req, "/mcp");
}

export async function DELETE(req: Request): Promise<Response> {
  return proxyToMcp(req, "/mcp");
}

export async function OPTIONS(): Promise<Response> {
  return mcpCorsPreflight();
}
