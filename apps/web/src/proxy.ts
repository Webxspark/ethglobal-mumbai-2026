import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, unsealSession } from "@/lib/session-crypto";
import {
  allowedCorsOrigins,
  publicUrl,
  safeReturnTo,
} from "@/lib/public-url";

const PUBLIC_PREFIXES = [
  "/api/auth",
  "/api/idkit",
  "/api/world",
  "/api/mcp",
  "/api/proofwork",
  "/api/connect",
  "/_next",
  "/favicon",
];

function isPublic(pathname: string): boolean {
  if (pathname === "/") return true;
  if (pathname.startsWith("/connect/authorize")) return true;
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

function applyCors(req: NextRequest, res: NextResponse): NextResponse {
  const origin = req.headers.get("origin");
  if (!origin) return res;
  if (!allowedCorsOrigins().includes(origin)) return res;
  res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Access-Control-Allow-Credentials", "true");
  res.headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  );
  res.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-PROOFWORK-CONNECT, X-PAYMENT, Mcp-Session-Id, Accept, Last-Event-ID",
  );
  res.headers.set("Access-Control-Expose-Headers", "Mcp-Session-Id");
  return res;
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Host / origin: public tunnel (pfw.alanchris.me + PROOFWORK_PUBLIC_URL) is
  // accepted via CORS allowlist + Next allowedDevOrigins. No hard Host reject
  // so temporary cloudflared URLs still work for demos.

  if (req.method === "OPTIONS" && pathname.startsWith("/api/")) {
    return applyCors(req, new NextResponse(null, { status: 204 }));
  }

  if (isPublic(pathname) || /\.[a-zA-Z0-9]+$/.test(pathname)) {
    return applyCors(req, NextResponse.next());
  }

  // Session gate — cookie is host-only (no Domain=) so tunnel + localhost
  // each keep their own jar; Secure is set by the login routes via
  // x-forwarded-proto / PROOFWORK_PUBLIC_URL.
  return unsealSession(req.cookies.get(SESSION_COOKIE)?.value ?? null).then(
    (session) => {
      if (session) {
        return applyCors(req, NextResponse.next());
      }
      const returnTo = safeReturnTo(pathname + req.nextUrl.search, "/");
      const login = publicUrl(
        `/?next=${encodeURIComponent(returnTo)}`,
        req,
      );
      return applyCors(req, NextResponse.redirect(login));
    },
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
