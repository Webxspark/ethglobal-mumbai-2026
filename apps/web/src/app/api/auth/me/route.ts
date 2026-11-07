import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { publicMcpUrl } from "@/lib/mcp-server";

export async function GET(): Promise<Response> {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ authenticated: false });
  }
  return NextResponse.json({
    authenticated: true,
    nullifierHash: session.nullifierHash,
    potId: session.potId,
    owner: session.owner,
    authMode: session.authMode,
    verificationLevel: session.verificationLevel ?? "none",
    oidcIss: session.oidcIss ?? null,
    mcpUrl: publicMcpUrl(),
  });
}
