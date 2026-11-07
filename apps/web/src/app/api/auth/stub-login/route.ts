import { NextResponse } from "next/server";

/** Stub sign-in removed — use OIDC via GET /api/auth/login. */
export async function POST(): Promise<Response> {
  return NextResponse.json(
    {
      error: "gone",
      message: "Stub sign-in was removed. Use Sign in with World ID (OpenID Connect).",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
