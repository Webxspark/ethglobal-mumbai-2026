import { NextResponse } from "next/server";
import { callMcpServerTool } from "@/lib/mcp-server";

/** Poll device auth status for the authorize panel (no secrets leaked). */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim();
  if (!code) {
    return NextResponse.json({ error: "code required" }, { status: 400 });
  }

  const hit = await callMcpServerTool<{
    status?: string;
    device_code?: string;
    user_code?: string;
    terms_version?: string;
    authorize_url?: string;
    expires_at?: number;
    potId?: string;
  }>("connect", { device_code: code });

  if (!hit.ok) {
    return NextResponse.json(
      { error: hit.error },
      { status: hit.status >= 400 ? hit.status : 400 },
    );
  }

  const r = hit.result as Record<string, unknown>;
  return NextResponse.json({
    status: r.status,
    device_code: r.device_code,
    user_code: r.user_code,
    terms_version: r.terms_version,
    expires_at: r.expires_at ?? r.expiresAt,
    potId: r.potId ?? null,
    authorized: r.status === "authorized",
  });
}
