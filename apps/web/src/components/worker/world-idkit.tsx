"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  IDKitRequestWidget,
  proofOfHuman,
  type IDKitResult,
  type RpContext,
} from "@worldcoin/idkit";
import {
  browserLooksLocal,
  clientPublicAppUrl,
  idkitApiUrl,
} from "@/lib/client-public-url";
import { formatIdKitError } from "@/lib/idkit-errors";
import { isIdKitReplayCode } from "@/lib/idkit-replay";
import { getSessionHonesty } from "@/lib/idkit-session";
import {
  PROOFWORK_LIVE_ORIGIN,
  worldBlockedCopy,
  type HonestyStatus,
} from "@/lib/honesty";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  signal?: string;
  onVerified: (i: { nullifierHash: string; proof: unknown }) => void;
  onCancel: () => void;
  onBlocked?: (message: string) => void;
  /** Bump to force a fresh rp-signature (retry / expiry). */
  retryKey?: number;
};

type RpBundle = {
  app_id: string;
  rp_id: string;
  action: string;
  environment: "staging" | "production";
  sig: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  publicAppUrl?: string;
};

type Verified = {
  nullifierHash: string;
  proof: unknown;
};

function rpStillFresh(rp: RpBundle, skewMs = 45_000): boolean {
  // expires_at is unix seconds from World RP signer.
  const expMs = rp.expires_at * 1000;
  return expMs - Date.now() > skewMs;
}

/**
 * Opens real World IDKit when staging/live keys are present.
 * Boots rp-signature exactly once per modal open; retryKey / expiry only.
 */
export function WorldIdKitGate({
  open,
  signal = "proofwork-worker",
  onVerified,
  onCancel,
  onBlocked,
  retryKey = 0,
}: Props) {
  const [status, setStatus] = useState<HonestyStatus | null>(null);
  const [rp, setRp] = useState<RpBundle | null>(null);
  const [attemptKey, setAttemptKey] = useState(0);
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [phase, setPhase] = useState<
    "loading" | "ready" | "blocked" | "error" | "use_public"
  >("loading");
  const [error, setError] = useState<string | null>(null);
  const verifiedRef = useRef<Verified | null>(null);
  const claimDoneRef = useRef(false);
  const publicOrigin = clientPublicAppUrl();

  // Keep latest callbacks without putting them in the boot effect deps.
  const onBlockedRef = useRef(onBlocked);
  const onVerifiedRef = useRef(onVerified);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onBlockedRef.current = onBlocked;
    onVerifiedRef.current = onVerified;
    onCancelRef.current = onCancel;
  });

  // One boot per open session. reopen / retryKey / expiry bump the token.
  const [expiryBump, setExpiryBump] = useState(0);
  const bootTokenRef = useRef<string | null>(null);
  const bootGen = open ? `open:${retryKey}:${expiryBump}` : "closed";

  useEffect(() => {
    if (!open) {
      bootTokenRef.current = null;
      setWidgetOpen(false);
      setRp(null);
      verifiedRef.current = null;
      claimDoneRef.current = false;
      setPhase("loading");
      setError(null);
      return;
    }

    // Already booted this open/retry cycle — ignore parent re-renders.
    if (bootTokenRef.current === bootGen) return;
    bootTokenRef.current = bootGen;

    let cancelled = false;
    (async () => {
      setPhase("loading");
      setError(null);
      setWidgetOpen(false);
      verifiedRef.current = null;
      claimDoneRef.current = false;
      try {
        const honesty = await getSessionHonesty();
        if (cancelled) return;
        setStatus(honesty);

        if (!honesty.world.idkitReady) {
          const msg = worldBlockedCopy(honesty);
          setPhase("blocked");
          setError(msg);
          onBlockedRef.current?.(msg);
          return;
        }

        const liveOrigin =
          honesty.world.publicAppUrl?.replace(/\/$/, "") || publicOrigin;
        if (
          browserLooksLocal() &&
          !/localhost|127\.0\.0\.1/i.test(liveOrigin)
        ) {
          setPhase("use_public");
          setError(
            `World IDKit QR fails on localhost (failed_by_host_app). Open ${liveOrigin} instead.`,
          );
          return;
        }

        const action = honesty.world.action;
        const res = await fetch(idkitApiUrl("/api/idkit/rp-signature"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({ action }),
        });
        const body = (await res.json()) as RpBundle & { error?: string };
        if (!res.ok) {
          throw new Error(body.error ?? `rp-signature HTTP ${res.status}`);
        }
        if (cancelled) return;
        setRp(body);
        setAttemptKey((k) => k + 1);
        setPhase("ready");
      } catch (e) {
        if (cancelled) return;
        setPhase("error");
        setError(e instanceof Error ? e.message : "World IDKit setup failed");
      }
    })();

    return () => {
      cancelled = true;
    };
    // Intentionally only open + bootGen + publicOrigin.
    // Callbacks go through refs so poll re-renders cannot re-fetch.
  }, [open, bootGen, publicOrigin]);

  // Schedule one refresh near RP expiry — not on every parent render.
  useEffect(() => {
    if (!open || !rp || phase !== "ready") return;
    const ms = rp.expires_at * 1000 - Date.now() - 45_000;
    if (ms <= 0) {
      if (!rpStillFresh(rp, 0)) setExpiryBump((n) => n + 1);
      return;
    }
    const t = window.setTimeout(() => setExpiryBump((n) => n + 1), ms);
    return () => window.clearTimeout(t);
  }, [open, rp, phase]);

  const completeVerified = useCallback(
    (hit: Verified) => {
      claimDoneRef.current = true;
      verifiedRef.current = hit;
      setWidgetOpen(false);
      setError(null);
      onVerifiedRef.current(hit);
    },
    [],
  );

  const postIdKitVerify = useCallback(
    async (result: unknown, opts?: { replayAck?: boolean }) => {
      const action = rp?.action ?? status?.world.action;
      const res = await fetch(idkitApiUrl("/api/idkit/verify"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(
          opts?.replayAck
            ? { replayAck: true, action }
            : { idkitResponse: result, action },
        ),
      });
      const body = (await res.json()) as {
        success?: boolean;
        nullifierHash?: string;
        error?: string;
        message?: string;
        environment?: string;
        publicAppUrl?: string;
        proof?: unknown;
      };
      if (!res.ok || !body.success || !body.nullifierHash) {
        const msg = formatIdKitError(body.error, body.message);
        setPhase("error");
        setError(msg);
        throw new Error(msg);
      }
      const proof = opts?.replayAck ? (body.proof ?? { replayAck: true }) : result;
      return {
        nullifierHash: body.nullifierHash,
        proof,
      } satisfies Verified;
    },
    [rp?.action, status?.world.action],
  );

  const handleVerify = useCallback(
    async (result: IDKitResult) => {
      try {
        const hit = await postIdKitVerify(result);
        completeVerified(hit);
      } catch {
        /* Stale / replayed proofs must not be re-posted to World — session replayAck only. */
        setError(null);
        setPhase("ready");
        try {
          const hit = await postIdKitVerify(null, { replayAck: true });
          completeVerified(hit);
        } catch {
          throw new Error("verify_failed");
        }
      }
    },
    [completeVerified, postIdKitVerify],
  );

  const onSuccess = useCallback(() => {
    if (claimDoneRef.current && verifiedRef.current) return;
    const hit = verifiedRef.current;
    if (!hit) return;
    completeVerified(hit);
  }, [completeVerified]);

  const handleReplayPortalError = useCallback(
    (code: string) => {
      if (claimDoneRef.current) return;
      if (process.env.NODE_ENV !== "production") {
        console.info("[idkit] portal replay — session replayAck (no World re-verify)");
      }
      void postIdKitVerify(null, { replayAck: true })
        .then(completeVerified)
        .catch(() => {
          if (!claimDoneRef.current && !isIdKitReplayCode(code)) {
            setPhase("error");
            setError(formatIdKitError(code, null));
          }
        });
    },
    [completeVerified, postIdKitVerify],
  );

  if (!open) return null;

  if (phase === "loading") {
    return <p className="text-[13px] text-muted-foreground">Checking World IDKit keys…</p>;
  }

  if (phase === "use_public") {
    const href =
      status?.world.publicAppUrl?.replace(/\/$/, "") ||
      PROOFWORK_LIVE_ORIGIN;
    return (
      <div className="space-y-3">
        <p className="text-[13px] text-[#b42318]" role="alert">
          {error}
        </p>
        <a
          className="block text-center text-[13px] font-medium underline underline-offset-2"
          href={href}
          target="_blank"
          rel="noreferrer"
        >
          {href}
        </a>
        <Button
          className="w-full"
          variant="ghost"
          onPress={() => onCancelRef.current()}
        >
          Cancel
        </Button>
      </div>
    );
  }

  if (phase === "blocked" || phase === "error") {
    return (
      <div className="space-y-3">
        <p className="text-[13px] text-[#b42318]" role="alert">
          {error}
        </p>
        {status?.world.redirectLooksLocal ? (
          <p className="text-center text-[12px] text-muted-foreground">
            Use{" "}
            <a
              className="underline"
              href={PROOFWORK_LIVE_ORIGIN}
              target="_blank"
              rel="noreferrer"
            >
              {PROOFWORK_LIVE_ORIGIN}
            </a>{" "}
            for Continuity / IDKit redirects.
          </p>
        ) : null}
        <Button
          className="w-full"
          variant="ghost"
          onPress={() => onCancelRef.current()}
        >
          Cancel
        </Button>
      </div>
    );
  }

  if (!rp) return null;

  const rpContext: RpContext = {
    rp_id: rp.rp_id,
    nonce: rp.nonce,
    created_at: rp.created_at,
    expires_at: rp.expires_at,
    signature: rp.sig,
  };

  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-5 text-muted-foreground">
        Verify once with World IDKit. We store a nullifier — never your ID
        documents.
        {rp.environment === "staging"
          ? " Staging identity for this event."
          : ""}
      </p>
      <Button className="w-full" onPress={() => setWidgetOpen(true)}>
        Verify with World
      </Button>
      <Button
        className="w-full"
        variant="ghost"
        onPress={() => onCancelRef.current()}
      >
        Cancel
      </Button>
      <IDKitRequestWidget
        key={`worker-idkit-${attemptKey}-${rp.nonce}`}
        open={widgetOpen}
        onOpenChange={setWidgetOpen}
        app_id={rp.app_id as `app_${string}`}
        action={rp.action}
        rp_context={rpContext}
        allow_legacy_proofs={true}
        environment={rp.environment}
        preset={proofOfHuman({ signal })}
        handleVerify={handleVerify}
        onSuccess={onSuccess}
        onError={(code, debug) => {
          if (claimDoneRef.current) return;
          if (code === "user_rejected") {
            setWidgetOpen(false);
            return;
          }
          if (isIdKitReplayCode(code)) {
            if (process.env.NODE_ENV !== "production") {
              console.info("[idkit] widget replay — finishing claim server-side", {
                code,
              });
            }
            handleReplayPortalError(code);
            return;
          }
          if (process.env.NODE_ENV !== "production") {
            console.info("[idkit] widget onError", { code, debug });
          }
          setPhase("error");
          setError(formatIdKitError(code, typeof debug === "string" ? debug : null));
        }}
      />
    </div>
  );
}
