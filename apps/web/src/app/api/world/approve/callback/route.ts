import { NextResponse } from "next/server";
import {
  WorldAuthError,
  completeLoginOidc,
  gateCompleteApproval,
  isLoginOidcState,
  type Address,
  type PotId,
} from "@proofwork/shared";
import { getWorldAuth } from "@/lib/worldAuth";
import { callMcpServerTool } from "@/lib/mcp-server";
import { publicUrl, safeReturnTo } from "@/lib/public-url";
import {
  sealSession,
  sessionCookieOptions,
  type ProofworkSession,
} from "@/lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Shared OIDC callback for:
 * - Sign in with World ID (`state` starts with `login.`)
 * - Agent Pass Continuity approval (`state` = `appr_….…`)
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const approvalIdParam = url.searchParams.get("approval_id");

  if (isLoginOidcState(state)) {
    return handleLoginCallback({ request, error, code, state });
  }

  return handleApprovalCallback({
    error,
    code,
    state,
    approvalIdParam,
  });
}

function redirectHome(
  request: Request,
  authError?: string,
): NextResponse {
  const dest = new URL(publicUrl("/", request));
  if (authError) dest.searchParams.set("auth_error", authError);
  return NextResponse.redirect(dest, 302);
}

async function handleLoginCallback(i: {
  request: Request;
  error: string | null;
  code: string | null;
  state: string | null;
}): Promise<Response> {
  if (i.error) {
    return redirectHome(
      i.request,
      i.error === "access_denied" ? "cancelled" : i.error,
    );
  }
  if (!i.code || !i.state) {
    return NextResponse.json(
      { success: false, error: "invalid_token", message: "missing code/state" },
      { status: 400 },
    );
  }

  try {
    const auth = getWorldAuth();
    const done = await completeLoginOidc({
      cfg: auth.config,
      code: i.code,
      state: i.state,
    });

    // Account key = OIDC sub. Maps prior nullifier-keyed pots when sub matches.
    const accountKey = done.identity.sub;
    const ensured = await callMcpServerTool<{
      potId: string;
      owner: string;
      nullifierHash: string;
    }>("ensure_account", {
      nullifierHash: accountKey,
      label: "world-oidc",
    });

    if (!ensured.ok) {
      return redirectHome(i.request, "mcp_unreachable");
    }

    const session: ProofworkSession = {
      nullifierHash: ensured.result.nullifierHash,
      potId: ensured.result.potId as PotId,
      owner: ensured.result.owner as Address,
      authMode: "live",
      createdAt: Math.floor(Date.now() / 1000),
      verificationLevel: done.verificationLevel,
      oidcIss: done.identity.iss,
    };

    const next = safeReturnTo(done.nextPath);
    const res = NextResponse.redirect(publicUrl(next, i.request), 302);
    res.cookies.set(
      sessionCookieOptions(await sealSession(session), i.request),
    );
    return res;
  } catch (err) {
    const code =
      err instanceof WorldAuthError ? err.code : "login_failed";
    return redirectHome(i.request, code);
  }
}

async function handleApprovalCallback(i: {
  error: string | null;
  code: string | null;
  state: string | null;
  approvalIdParam: string | null;
}): Promise<Response> {
  if (i.error) {
    const auth = getWorldAuth();
    const approvalId =
      i.approvalIdParam ??
      (i.state?.includes(".") ? i.state.split(".")[0] : null);
    if (approvalId) {
      await auth.world
        .denyOwnerApproval({
          approvalId,
          reason: i.error === "access_denied" ? "approval_denied" : "cancelled",
        })
        .catch(() => undefined);
    }
    return NextResponse.json(
      {
        success: false,
        error: i.error === "access_denied" ? "approval_denied" : "cancelled",
        oauth_error: i.error,
      },
      { status: 403 },
    );
  }

  if (!i.code || !i.state) {
    return NextResponse.json(
      { success: false, error: "invalid_token", message: "missing code/state" },
      { status: 400 },
    );
  }

  const approvalId =
    i.approvalIdParam ??
    (i.state.includes(".") ? i.state.split(".")[0]! : "");

  if (!approvalId) {
    return NextResponse.json(
      {
        success: false,
        error: "invalid_token",
        message: "cannot resolve approvalId from state",
      },
      { status: 400 },
    );
  }

  try {
    const auth = getWorldAuth();
    const result = await gateCompleteApproval(auth.world, {
      approvalId,
      code: i.code,
      state: i.state,
    });
    return NextResponse.json({
      success: true,
      approvalId: result.approvalId,
      identity: result.identity,
      authTime: result.authTime,
      note: "Owner approval granted — agent may proceed with encumber/post.",
    });
  } catch (err) {
    if (err instanceof WorldAuthError) {
      return NextResponse.json(
        { success: false, error: err.code, message: err.message },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { success: false, error: "invalid_token", message: String(err) },
      { status: 400 },
    );
  }
}
