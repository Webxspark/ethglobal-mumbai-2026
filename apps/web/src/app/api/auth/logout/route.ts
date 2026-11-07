import { NextResponse } from "next/server";
import { clearSessionCookieOptions } from "@/lib/session";
import { publicUrl, safeReturnTo } from "@/lib/public-url";

export async function POST(request: Request): Promise<Response> {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(clearSessionCookieOptions(request));
  return res;
}

/** Optional browser logout — clears cookie and redirects via public origin. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const next = safeReturnTo(url.searchParams.get("next"), "/");
  const res = NextResponse.redirect(publicUrl(next, request), 302);
  res.cookies.set(clearSessionCookieOptions(request));
  return res;
}
