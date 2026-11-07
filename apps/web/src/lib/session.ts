import { cookies } from "next/headers";
import type { Address, PotId } from "@proofwork/shared";
import {
  SESSION_COOKIE,
  sealSession as seal,
  unsealSession as unseal,
  type ProofworkSession as RawSession,
} from "./session-crypto";
import { sessionCookieSecure } from "./public-url";

export { SESSION_COOKIE };
const MAX_AGE_SECS = 60 * 60 * 24 * 7;

export type ProofworkSession = {
  /** Account key — OIDC `sub` (maps prior nullifier-keyed pots when equal). */
  nullifierHash: string;
  potId: PotId;
  owner: Address;
  authMode: "live";
  createdAt: number;
  verificationLevel?: "orb" | "device" | "none";
  oidcIss?: string;
  /** IDKit PoH nullifier from first gig-claim verify for this account. */
  claimNullifier?: string;
};

export async function sealSession(session: ProofworkSession): Promise<string> {
  return seal(session as RawSession);
}

export async function unsealSession(
  raw: string | undefined | null,
): Promise<ProofworkSession | null> {
  const hit = await unseal(raw);
  if (!hit) return null;
  return hit as ProofworkSession;
}

export async function readSession(): Promise<ProofworkSession | null> {
  const jar = await cookies();
  return unsealSession(jar.get(SESSION_COOKIE)?.value);
}

export function sessionCookieOptions(token: string, request?: Request) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    // Host-only cookie (no Domain) — works on tunnel hostname + localhost.
    secure: sessionCookieSecure(request),
    path: "/",
    maxAge: MAX_AGE_SECS,
  };
}

export function clearSessionCookieOptions(request?: Request) {
  return {
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: sessionCookieSecure(request),
    path: "/",
    maxAge: 0,
  };
}
