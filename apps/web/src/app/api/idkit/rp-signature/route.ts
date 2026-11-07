import { NextResponse } from "next/server";
import { debugInfo } from "@/lib/debug";
import { getWorldAuth } from "@/lib/worldAuth";
import { readPublicAppUrl } from "@/lib/public-url";

// Fresh nonce + timestamps every hit — never statically cache this route.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * IDKit RP signature — never expose WORLD_IDKIT_RP_SIGNING_KEY to the client.
 *
 * Body:
 *   { action?: string }           → uniqueness / enrollment signature
 *   { omitAction: true } | { action: null } → session-only signature (no action)
 *
 * Always returns a brand-new cryptographically random nonce.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string | null;
      omitAction?: boolean;
    };
    const auth = getWorldAuth();
    const environment = auth.config.idkit.environment;
    const appId = auth.config.idkit.appId;
    const rpId = auth.config.idkit.rpId;
    const omitAction = body.omitAction === true || body.action === null;
    const action = omitAction
      ? null
      : (body.action ?? auth.config.idkit.action);

    // Production World App rejects staging-only app ids / bad rp shape.
    if (environment === "production" && appId.startsWith("app_staging_")) {
      return NextResponse.json(
        {
          error:
            "WORLD_IDKIT_APP_ID is app_staging_* but WORLD_IDKIT_ENVIRONMENT=production",
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!/^rp_[0-9a-fA-F]+$/.test(rpId)) {
      return NextResponse.json(
        {
          error:
            "WORLD_IDKIT_RP_ID must look like rp_<hex> (Portal relying party id)",
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!appId.startsWith("app_")) {
      return NextResponse.json(
        { error: "WORLD_IDKIT_APP_ID must start with app_" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const signed = await auth.signRpRequest(action);

    const payload = {
      ...signed,
      app_id: appId,
      rp_id: rpId,
      action: omitAction ? null : action,
      omitAction,
      environment,
      publicAppUrl: readPublicAppUrl(),
      // Clients must open IDKit on this origin — never window.localhost.
      verifyPath: "/api/idkit/verify",
    };

    debugInfo("[api/idkit/rp-signature] request payload keys + env", {
      keys: Object.keys(payload),
      environment,
      omitAction,
      hasAction: action != null,
      app_id_prefix: appId.slice(0, 12),
      rp_id_prefix: rpId.slice(0, 8),
    });

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    });
  } catch (err) {
    console.error("[api/idkit/rp-signature] failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "rp_signature_failed" },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
