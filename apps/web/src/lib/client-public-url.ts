"use client";

import { FALLBACK_PUBLIC_ORIGIN } from "@/lib/public-url";

/**
 * Browser-side public origin for IDKit / Continuity.
 * Never fall back to window.location when a public URL is configured —
 * localhost QR flows get rejected by World App / Continuity.
 */
export function clientPublicAppUrl(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_PROOFWORK_PUBLIC_URL?.trim() ||
    process.env.NEXT_PUBLIC_PROOFWORK_ORIGIN?.trim() ||
    "";
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return FALLBACK_PUBLIC_ORIGIN;
}

export function browserLooksLocal(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "[::1]"
  );
}

/** Absolute URL for IDKit verify / login callbacks (public host preferred). */
export function idkitApiUrl(path: string): string {
  const base = clientPublicAppUrl();
  const p = path.startsWith("/") ? path : `/${path}`;
  if (typeof window !== "undefined") {
    // Same host as the configured public URL → relative is fine (and keeps cookies).
    try {
      if (new URL(base).host === window.location.host) {
        return p;
      }
    } catch {
      /* fall through */
    }
    // Viewing localhost but keys expect the tunnel — hit the public origin.
    if (browserLooksLocal()) {
      return `${base}${p}`;
    }
  }
  return p;
}
