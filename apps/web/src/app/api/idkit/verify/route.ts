import { NextResponse } from "next/server";
import {
  WorldAuthError,
  gateWorkerAccept,
  readableIdKitError,
} from "@proofwork/shared";
import { debugInfo } from "@/lib/debug";
import { getWorldAuth } from "@/lib/worldAuth";
import { readPublicAppUrl } from "@/lib/public-url";
import {
  hydrateClaimStoreFromSession,
  webClaimNullifierStore,
} from "@/lib/claim-nullifier-store";
import { resolveBoundClaimNullifier } from "@/lib/resolve-claim-nullifier";
import {
  readSession,
  sealSession,
  sessionCookieOptions,
  type ProofworkSession,
} from "@/lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * IDKit Proof of Human verify callback for worker accept.
 * Body: { idkitResponse | proof, signal?, nullifierHash?, action?, replayAck? }
 * Returns { nullifierHash, verified } or a prize-aligned denial code.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = getWorldAuth();
  const publicAppUrl = readPublicAppUrl();
  try {
    const body = (await request.json()) as {
      idkitResponse?: unknown;
      proof?: unknown;
      signal?: string;
      nullifierHash?: string;
      action?: string;
      replayAck?: boolean;
    };

    const action = body.action ?? auth.config.idkit.action;
    const signal = body.signal ?? action;
    const session = await readSession();

    if (body.replayAck === true) {
      if (!session?.nullifierHash) {
        return NextResponse.json(
          { success: false, error: "sign_in_required", message: "Sign in required" },
          { status: 401 },
        );
      }
      const bound = await resolveBoundClaimNullifier(session);
      if (!bound) {
        return NextResponse.json(
          {
            success: false,
            error: "verify_failed",
            message: readableIdKitError("verify_failed", "claim_poh_not_bound"),
          },
          { status: 400 },
        );
      }
      const human = await gateWorkerAccept(auth.human, {
        proof: { replayAck: true },
        signal,
        action,
        accountKey: session.nullifierHash,
        claimStore: webClaimNullifierStore(),
        boundClaimNullifier: bound,
        environment: auth.config.idkit.environment,
      });
      const res = NextResponse.json({
        success: true,
        nullifierHash: human.nullifierHash,
        verified: true,
        alreadyVerified: true,
        environment: human.environment,
        action: human.action,
        publicAppUrl,
        proof: { replayAck: true },
      });
      if (session.claimNullifier !== human.nullifierHash) {
        const next: ProofworkSession = {
          ...session,
          claimNullifier: human.nullifierHash,
        };
        res.cookies.set(
          sessionCookieOptions(await sealSession(next), request),
        );
      }
      return res;
    }

    // Forward raw IDKit JSON — no field picks / zod reshape before portal verify.
    const proof = body.idkitResponse ?? body.proof;
    if (!proof) {
      return NextResponse.json(
        { error: "invalid_proof", message: "missing idkitResponse" },
        { status: 400 },
      );
    }
    if (proof && typeof proof === "object" && !Array.isArray(proof)) {
      debugInfo("[api/idkit/verify] request payload keys + env", {
        keys: Object.keys(proof as Record<string, unknown>),
        environment: auth.config.idkit.environment,
        proofEnv: (proof as { environment?: string }).environment,
      });
    }

    if (session?.nullifierHash) {
      hydrateClaimStoreFromSession(
        session.nullifierHash,
        session.claimNullifier,
      );
    }

    const human = await gateWorkerAccept(auth.human, {
      proof,
      signal,
      nullifierHash: body.nullifierHash,
      action,
      accountKey: session?.nullifierHash,
      claimStore: session?.nullifierHash ? webClaimNullifierStore() : undefined,
      environment: auth.config.idkit.environment,
    });

    const payload = {
      success: true,
      nullifierHash: human.nullifierHash,
      verified: true,
      alreadyVerified: false as boolean,
      environment: human.environment,
      action: human.action,
      publicAppUrl,
      proof,
    };

    const res = NextResponse.json(payload);
    if (
      session?.nullifierHash &&
      human.nullifierHash &&
      session.claimNullifier !== human.nullifierHash
    ) {
      const next: ProofworkSession = {
        ...session,
        claimNullifier: human.nullifierHash,
      };
      res.cookies.set(
        sessionCookieOptions(await sealSession(next), request),
      );
    }
    return res;
  } catch (err) {
    if (err instanceof WorldAuthError) {
      console.error("[api/idkit/verify] WorldAuthError", {
        code: err.code,
        message: err.message,
        environment: auth.config.idkit.environment,
        publicAppUrl,
      });
      const status =
        err.code === "banned_nullifier"
          ? 403
          : err.code === "cancelled"
            ? 409
            : 400;
      return NextResponse.json(
        {
          success: false,
          error: err.code,
          message: readableIdKitError(err.code, err.message),
          environment: auth.config.idkit.environment,
          publicAppUrl,
        },
        { status, headers: { "Cache-Control": "no-store" } },
      );
    }
    console.error("[api/idkit/verify] unexpected", err);
    return NextResponse.json(
      {
        success: false,
        error: "verify_failed",
        message: readableIdKitError("verify_failed", null),
        publicAppUrl,
      },
      { status: 400 },
    );
  }
}
