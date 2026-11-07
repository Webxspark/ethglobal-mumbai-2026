"use client";

import { Suspense, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card } from "@heroui/react";
import { WorldSignIn } from "@/components/auth/world-sign-in";
import { Button } from "@/components/ui/button";
import { Toast } from "@/components/ui/toast";
import { safeReturnTo } from "@/lib/public-url";
import { useSession } from "@/lib/use-session";

function AuthCard({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-[6px] border border-[#e6e8eb] shadow-none">
      {title ? (
        <Card.Header className="px-3.5 pb-0 pt-3.5">
          <Card.Title className="text-[13px] font-semibold tracking-tight">
            {title}
          </Card.Title>
        </Card.Header>
      ) : null}
      <Card.Content className="space-y-3 px-3.5 pb-3.5 pt-2">
        {children}
      </Card.Content>
    </Card>
  );
}

type DeviceStatus = {
  status?: string;
  user_code?: string;
  terms_version?: string;
  expires_at?: number;
  authorized?: boolean;
  error?: string;
};

function AuthorizeInner() {
  const params = useSearchParams();
  const code = params.get("code")?.trim() ?? "";
  const router = useRouter();
  const { session, loading, refresh } = useSession();
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const nextPath = useMemo(
    () =>
      safeReturnTo(
        `/connect/authorize?code=${encodeURIComponent(code)}`,
        "/connect/authorize",
      ),
    [code],
  );

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/connect/status?code=${encodeURIComponent(code)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as DeviceStatus;
        if (!cancelled) setStatus(json);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "status failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  function approve() {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/connect/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_code: code }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(body.message ?? body.error ?? "Approve failed");
        return;
      }
      setDone(true);
      await refresh();
    });
  }

  if (!code) {
    return (
      <main className="pw-hub min-h-dvh">
        <div className="mx-auto max-w-md px-4 py-14">
          <p className="pw-brand">Proofwork</p>
          <h1 className="pw-title mt-4">Authorize agent</h1>
          <p className="pw-subtitle mt-2">
            Missing <span className="font-mono">code</span> — start from MCP{" "}
            <span className="font-mono">connect</span>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="pw-hub min-h-dvh">
      <div className="mx-auto max-w-md space-y-6 px-4 py-14">
        <header className="space-y-1">
          <p className="pw-brand">Proofwork</p>
          <h1 className="pw-title mt-3">Authorize agent</h1>
          <p className="pw-subtitle">
            Device{" "}
            <span className="font-mono text-[12px]">
              {status?.user_code ?? "…"}
            </span>{" "}
            · terms{" "}
            <span className="font-mono text-[11px]">
              {status?.terms_version ?? "—"}
            </span>
          </p>
        </header>

        <div className="pw-hub-sponsors" aria-label="Sponsors">
          <span>World</span>
          <span>Hedera</span>
          <span>Arkiv</span>
        </div>

        {loading ? (
          <div className="space-y-2" aria-busy="true">
            <div className="pw-skeleton h-8" />
            <div className="pw-skeleton h-24" />
          </div>
        ) : !session?.authenticated ? (
          <AuthCard title="Sign in to approve">
            <WorldSignIn nextPath={nextPath} />
          </AuthCard>
        ) : done || status?.authorized ? (
          <AuthCard title="Agent connected">
            <p className="text-[13px] text-muted-foreground">
              A long-lived bearer token is bound to your pot (persisted server-side).
              The posting agent can reconnect with{" "}
              <span className="font-mono text-[11px]">connect</span> without asking
              you to approve again each session.
            </p>
            <Button
              variant="secondary"
              onPress={() => router.push("/owner/agents")}
            >
              Back to agents
            </Button>
          </AuthCard>
        ) : (
          <AuthCard>
            <p className="text-[13px] leading-5 text-muted-foreground">
              An agent accepted the Terms and wants access to pot{" "}
              <span className="font-mono text-[11px]">
                {session.potId?.slice(0, 14)}…
              </span>
              . Approve only if you started that agent.
            </p>
            {status?.status === "pending_terms" ? (
              <Toast tone="error">
                Agent has not called accept_terms yet — wait, then refresh.
              </Toast>
            ) : null}
            {status?.status === "expired" ? (
              <Toast tone="error">This code expired — restart connect.</Toast>
            ) : null}
            <Button
              className="h-10 w-full"
              disabled={pending || status?.status === "pending_terms"}
              onPress={approve}
            >
              {pending ? "Approving…" : "Approve agent"}
            </Button>
            {error ? <Toast tone="error">{error}</Toast> : null}
          </AuthCard>
        )}
      </div>
    </main>
  );
}

export default function AuthorizePage() {
  return (
    <Suspense
      fallback={
        <main className="pw-hub min-h-dvh px-4 py-14">
          <p className="text-[13px] text-muted-foreground">Loading…</p>
        </main>
      }
    >
      <AuthorizeInner />
    </Suspense>
  );
}
