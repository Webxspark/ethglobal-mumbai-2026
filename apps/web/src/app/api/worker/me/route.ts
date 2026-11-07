import { NextResponse } from "next/server";
import { workerFromNullifier } from "@proofwork/shared";
import { readSession } from "@/lib/session";

/** Current worker identity from the World session cookie. */
export async function GET(): Promise<Response> {
  const session = await readSession();
  if (!session?.nullifierHash) {
    return NextResponse.json({ authenticated: false });
  }
  return NextResponse.json({
    authenticated: true,
    nullifierHash: session.nullifierHash,
    worker: workerFromNullifier(session.nullifierHash),
    authMode: session.authMode,
  });
}
