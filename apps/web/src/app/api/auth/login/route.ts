import { NextResponse } from "next/server";
import {
  WorldAuthError,
  beginLoginOidc,
  oidcLoginConfigured,
} from "@proofwork/shared";
import { getWorldAuth } from "@/lib/worldAuth";
import { safeReturnTo } from "@/lib/public-url";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Sign in with World ID — start OIDC authorization-code (+ PKCE).
 * Browser lands on World, then shared `/api/world/approve/callback`
 * (state prefix `login.` vs Agent Pass `appr_…`).
 *
 * Query: next=/owner/pot
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const nextPath = safeReturnTo(url.searchParams.get("next"));
  const auth = getWorldAuth();

  if (!oidcLoginConfigured(auth.config)) {
    return NextResponse.json(
      {
        error: "oidc_not_configured",
        message:
          "Set WORLD_AGENT_PASS_CLIENT_ID and WORLD_AGENT_PASS_CLIENT_SECRET (Sign in reuses that OIDC client). Optional WORLD_OIDC_* overrides.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const started = await beginLoginOidc({
      cfg: auth.config,
      nextPath,
    });
    // World IdP — external absolute URL, not our public origin.
    return NextResponse.redirect(started.authorizeUrl, 302);
  } catch (err) {
    if (err instanceof WorldAuthError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { error: "login_start_failed", message: String(err) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
