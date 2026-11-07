import { NextResponse } from "next/server";
import { workerFromNullifier } from "@proofwork/shared";
import { callMcpToolServer } from "@/lib/fund/mcp-server";
import { readSession } from "@/lib/session";

/**
 * Session-backed claim. Worker id is derived server-side from the World
 * session nullifier — client never supplies DEMO_WORKER / 0x2222….
 */
export async function POST(req: Request): Promise<Response> {
  const session = await readSession();
  if (!session?.nullifierHash) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  let body: {
    taskId?: string;
    proof?: unknown;
    signal?: string;
    action?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const taskId = body.taskId?.trim();
  if (!taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }
  const nullifier = session.nullifierHash;
  const worker = workerFromNullifier(nullifier);
  if (body.proof == null) {
    return NextResponse.json(
      { error: "proof required — complete IDKit in the client first" },
      { status: 400 },
    );
  }
  try {
    const result = await callMcpToolServer<Record<string, unknown>>("accept", {
      taskId,
      humanNullifier: nullifier,
      proof: body.proof,
      signal: body.signal ?? worker,
      action: body.action,
    });
    return NextResponse.json({
      ...result,
      worker,
      humanNullifier: nullifier,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "accept failed";
    const status = /proof|live|required|blocked/i.test(msg) ? 400 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
