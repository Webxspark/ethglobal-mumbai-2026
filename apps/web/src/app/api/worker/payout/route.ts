import { NextResponse } from "next/server";
import { workerFromNullifier } from "@proofwork/shared";
import { callMcpToolServer } from "@/lib/fund/mcp-server";
import { readSession } from "@/lib/session";

/**
 * Session-backed worker payout. userId is always the World session
 * nullifier/sub — never a client-supplied demo worker id.
 */
export async function GET(): Promise<Response> {
  const session = await readSession();
  if (!session?.nullifierHash) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const nullifier = session.nullifierHash;
  try {
    const row = await callMcpToolServer<{
      userId: string;
      payoutAddress: string | null;
      worker?: string;
    }>("worker_get_payout", { userId: nullifier });
    return NextResponse.json({
      userId: nullifier,
      worker: row.worker ?? workerFromNullifier(nullifier),
      payoutAddress: row.payoutAddress ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "payout lookup failed" },
      { status: 502 },
    );
  }
}

export async function POST(req: Request): Promise<Response> {
  const session = await readSession();
  if (!session?.nullifierHash) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  let body: { payoutAddress?: string };
  try {
    body = (await req.json()) as { payoutAddress?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const payoutAddress = body.payoutAddress?.trim();
  if (!payoutAddress || !/^0x[a-fA-F0-9]{40}$/.test(payoutAddress)) {
    return NextResponse.json(
      { error: "payoutAddress must be 0x + 40 hex" },
      { status: 400 },
    );
  }
  const nullifier = session.nullifierHash;
  try {
    const row = await callMcpToolServer<{
      userId: string;
      payoutAddress: string;
      worker?: string;
      repairedTaskIds?: string[];
    }>("worker_set_payout", {
      userId: nullifier,
      payoutAddress,
    });
    return NextResponse.json({
      userId: nullifier,
      worker: row.worker ?? workerFromNullifier(nullifier),
      payoutAddress: row.payoutAddress,
      repairedTaskIds: row.repairedTaskIds ?? [],
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "payout save failed" },
      { status: 502 },
    );
  }
}
