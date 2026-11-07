"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchHonestyStatus,
  type HonestyStatus,
} from "@/lib/honesty";
import { safeReturnTo } from "@/lib/public-url";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button-variants";

type Props = {
  /** Where to send the browser after a successful sign-in. */
  nextPath?: string;
};

/**
 * Sign in with World ID — OpenID Connect redirect (not IDKit).
 * GET /api/auth/login → World authorize → /api/world/approve/callback.
 */
export function WorldSignIn({ nextPath = "/owner" }: Props) {
  const [honesty, setHonesty] = useState<HonestyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const next = safeReturnTo(nextPath);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await fetchHonestyStatus();
        if (!cancelled) setHonesty(h);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "World setup failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const oidcReady = honesty?.world.oidcReady === true;
  const loginHref = `/api/auth/login?next=${encodeURIComponent(next)}`;

  return (
    <div className="pw-signin space-y-3" data-testid="world-sign-in">
      <p className="text-[12px] leading-5 text-muted-foreground">
        World ID binds one human to one pot. Agents need your approve.
      </p>

      <Link
        href={loginHref}
        prefetch={false}
        className={cn(
          buttonVariants({ size: "sm" }),
          "h-8 w-full inline-flex items-center justify-center text-[13px]",
        )}
        data-testid="world-sign-in-button"
      >
        Continue with World ID
      </Link>

      {!oidcReady && honesty !== null ? (
        <p className="text-[11px] leading-4 text-muted-foreground">
          Configure Continuity redirect +{" "}
          <span className="font-mono">WORLD_AGENT_PASS_CLIENT_ID</span> /{" "}
          <span className="font-mono">SECRET</span> for OIDC. Localhost
          redirect URIs are often rejected — use a public dev URL.
        </p>
      ) : null}

      {error ? (
        <p className="pw-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
