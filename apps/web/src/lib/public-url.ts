/**
 * Tunnel-safe public URL helpers.
 * Prefer PROOFWORK_PUBLIC_URL (and NEXT_PUBLIC_ mirror) over window/localhost.
 */

const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i;

export const FALLBACK_PUBLIC_ORIGIN = "https://pfw.alanchris.me";

type HeaderSource = { headers: Headers };

export function readPublicAppUrl(
  env: NodeJS.Dict<string> = process.env,
): string {
  const raw =
    env.PROOFWORK_PUBLIC_URL?.trim() ||
    env.NEXT_PUBLIC_PROOFWORK_PUBLIC_URL?.trim() ||
    "";
  if (raw) return raw.replace(/\/$/, "");
  return "http://127.0.0.1:38471";
}

export function hostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

export function isLocalHostname(host: string | null | undefined): boolean {
  if (!host) return true;
  return LOCAL_HOST_RE.test(host);
}

export function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Same-origin relative return path only.
 * Blocks //evil, http://…, backslash tricks, control chars.
 */
export function safeReturnTo(
  raw: string | null | undefined,
  fallback = "/owner",
): string {
  const next = (raw ?? "").trim() || fallback;
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  if (next.includes("://") || next.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  return next;
}

function firstHeader(
  headers: Headers,
  name: string,
): string | null {
  const raw = headers.get(name);
  if (!raw) return null;
  const hit = raw.split(",")[0]?.trim();
  return hit || null;
}

function hostnameFromHostHeader(host: string): string | null {
  try {
    return new URL(`http://${host}`).hostname || null;
  } catch {
    return null;
  }
}

/**
 * Public origin for redirects behind `next start -H 0.0.0.0` + tunnel.
 * Order: non-local PROOFWORK_PUBLIC_URL → x-forwarded-* / Host → configured
 * local URL → 127.0.0.1 fallback. Never keeps 0.0.0.0 when a public URL is set.
 */
export function resolvePublicOrigin(
  request?: HeaderSource,
  env: NodeJS.Dict<string> = process.env,
): string {
  const configured =
    env.PROOFWORK_PUBLIC_URL?.trim() ||
    env.NEXT_PUBLIC_PROOFWORK_PUBLIC_URL?.trim() ||
    "";
  const configuredOrigin = configured.replace(/\/$/, "");
  const configuredHost = configuredOrigin
    ? hostnameFromUrl(configuredOrigin)
    : null;

  if (configuredHost && !isLocalHostname(configuredHost)) {
    return configuredOrigin;
  }

  if (request) {
    const xfProto = firstHeader(request.headers, "x-forwarded-proto");
    const xfHost = firstHeader(request.headers, "x-forwarded-host");
    const hostHdr = xfHost || firstHeader(request.headers, "host");
    if (hostHdr) {
      const hn = hostnameFromHostHeader(hostHdr);
      if (hn && !isLocalHostname(hn)) {
        const proto = (xfProto || "https").replace(/:$/, "");
        return `${proto}://${hostHdr}`.replace(/\/$/, "");
      }
    }
  }

  if (configuredOrigin) return configuredOrigin;
  return "http://127.0.0.1:38471";
}

/** Absolute public URL for `path` (must be same-origin relative, e.g. `/owner/pot`). */
export function publicUrl(
  path: string,
  request?: HeaderSource,
  env: NodeJS.Dict<string> = process.env,
): string {
  const origin = resolvePublicOrigin(request, env);
  const raw = path.trim() || "/";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return new URL(withSlash, `${origin}/`).toString();
}

/** Hostnames Next should allow for cross-origin HMR / assets in `next dev`. */
export function allowedDevOriginsFromEnv(
  env: NodeJS.Dict<string> = process.env,
): string[] {
  const hosts = new Set<string>([
    "127.0.0.1",
    "localhost",
    "pfw.alanchris.me",
    "*.alanchris.me",
  ]);

  const pub = readPublicAppUrl(env);
  const host = hostnameFromUrl(pub);
  if (host && !isLocalHostname(host)) {
    hosts.add(host);
    const labels = host.split(".");
    if (labels.length >= 2) {
      hosts.add(`*.${labels.slice(-2).join(".")}`);
    }
    if (labels.length >= 3) {
      hosts.add(`*.${labels.slice(1).join(".")}`);
    }
  }

  return [...hosts];
}

/**
 * Secure cookies when serving HTTPS (production, public https URL, or
 * x-forwarded-proto from a tunnel / reverse proxy).
 */
export function sessionCookieSecure(request?: Request): boolean {
  if (process.env.NODE_ENV === "production") return true;
  if (isHttpsUrl(readPublicAppUrl())) return true;
  if (request) {
    const xf = request.headers.get("x-forwarded-proto");
    if (xf?.split(",")[0]?.trim().toLowerCase() === "https") return true;
    try {
      if (new URL(request.url).protocol === "https:") return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

/** Origins that may call our APIs cross-origin (tunnel ↔ localhost demos). */
export function allowedCorsOrigins(
  env: NodeJS.Dict<string> = process.env,
): string[] {
  const out = new Set<string>([
    "http://127.0.0.1:38471",
    "http://localhost:38471",
    FALLBACK_PUBLIC_ORIGIN,
  ]);
  const pub = readPublicAppUrl(env);
  if (pub) out.add(pub);
  return [...out];
}
