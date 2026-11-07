import { NextResponse } from "next/server";
import { callMcpServerTool } from "@/lib/mcp-server";
import { readSession } from "@/lib/session";

/** World-gated human approval of an agent device_code. */
export async function POST(request: Request): Promise<Response> {
  const session = await readSession();
  if (!session) {
    return NextResponse.json(
      { error: "unauthorized", message: "Sign in with World ID first" },
      { status: 401 },
    );
  }

  const body = (await request.json()) as {
    device_code?: string;
    deviceCode?: string;
  };
  const deviceCode =
    body.device_code?.trim() || body.deviceCode?.trim() || "";
  if (!deviceCode) {
    return NextResponse.json(
      { error: "device_code required" },
      { status: 400 },
    );
  }

  const hit = await callMcpServerTool<{
    token: string;
    potId: string;
    expiresAt: number;
    termsVersion: string;
  }>("authorize_connect", {
    device_code: deviceCode,
    nullifierHash: session.nullifierHash,
    potId: session.potId,
    owner: session.owner,
  });

  if (!hit.ok) {
    return NextResponse.json(
      { error: hit.error, message: hit.error },
      { status: hit.status >= 400 ? hit.status : 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    token: hit.result.token,
    potId: hit.result.potId,
    expiresAt: hit.result.expiresAt,
    termsVersion: hit.result.termsVersion,
  });
}
