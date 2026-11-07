import { createHash, randomBytes } from "node:crypto";
import type { WorldAuthConfig } from "../../env/worldAuthConfig.js";
import type { WorldIdentity } from "../../worldAuthTypes.js";
import { WorldAuthError } from "../../worldAuthTypes.js";

export type OidcDiscovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

export type VerificationLevel = "orb" | "device" | "none";

export type ValidatedIdToken = {
  identity: WorldIdentity;
  authTime: number;
  acr?: string;
  amr?: string[];
  nonce?: string;
  /** Normalized from `acr` or `https://id.worldcoin.org/v1.verification_level`. */
  verificationLevel: VerificationLevel;
  rawClaims: Record<string, unknown>;
};

const discoveryCache = new Map<string, { at: number; doc: OidcDiscovery }>();

export function base64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function randomToken(bytes = 32): string {
  return base64Url(randomBytes(bytes));
}

export function pkceChallenge(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier).digest());
}

export async function fetchDiscovery(
  issuer: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OidcDiscovery> {
  const cached = discoveryCache.get(issuer);
  if (cached && Date.now() - cached.at < 60 * 60 * 1000) {
    return cached.doc;
  }
  const url = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new WorldAuthError(
      "invalid_token",
      `OIDC discovery failed: ${res.status}`,
    );
  }
  const doc = (await res.json()) as OidcDiscovery;
  discoveryCache.set(issuer, { at: Date.now(), doc });
  return doc;
}

export function buildAuthorizeUrl(i: {
  discovery: OidcDiscovery;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  /** When set, Continuity-style freshness. Omit for normal Sign in. */
  maxAgeSecs?: number;
  scope?: string;
}): string {
  const u = new URL(i.discovery.authorization_endpoint);
  u.searchParams.set("client_id", i.clientId);
  u.searchParams.set("redirect_uri", i.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", i.scope ?? "openid");
  u.searchParams.set("state", i.state);
  u.searchParams.set("nonce", i.nonce);
  u.searchParams.set("code_challenge", i.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  if (i.maxAgeSecs !== undefined) {
    u.searchParams.set("max_age", String(i.maxAgeSecs));
    // Continuity step-up: prefer login when max_age=0
    if (i.maxAgeSecs === 0) {
      u.searchParams.set("prompt", "login");
    }
  }
  return u.toString();
}

/** Map World IdP `acr` / legacy verification_level claims → orb | device | none. */
export function verificationLevelFromClaims(
  payload: Record<string, unknown>,
): VerificationLevel {
  const legacy = payload["https://id.worldcoin.org/v1"];
  if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
    const level = String(
      (legacy as { verification_level?: unknown }).verification_level ?? "",
    ).toLowerCase();
    if (level === "orb") return "orb";
    if (level === "device" || level === "orb-face" || level === "selfie") {
      return "device";
    }
  }
  const acr = typeof payload.acr === "string" ? payload.acr.toLowerCase() : "";
  if (acr.includes("/orb") && !acr.includes("orb-face")) return "orb";
  if (acr.includes("orb-face") || acr.includes("device") || acr.includes("selfie")) {
    return "device";
  }
  if (acr.includes("orb")) return "orb";
  return "none";
}

export async function exchangeCode(i: {
  discovery: OidcDiscovery;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  fetchImpl?: typeof fetch;
}): Promise<{ id_token: string }> {
  const fetchImpl = i.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: i.code,
    redirect_uri: i.redirectUri,
    client_id: i.clientId,
    code_verifier: i.codeVerifier,
  });
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (i.clientSecret) {
    headers.authorization = `Basic ${Buffer.from(
      `${i.clientId}:${i.clientSecret}`,
    ).toString("base64")}`;
  }
  const res = await fetchImpl(i.discovery.token_endpoint, {
    method: "POST",
    headers,
    body,
  });
  if (!res.ok) {
    throw new WorldAuthError(
      "invalid_token",
      `token exchange failed: ${res.status}`,
    );
  }
  const json = (await res.json()) as { id_token?: string };
  if (!json.id_token) {
    throw new WorldAuthError("invalid_token", "token response missing id_token");
  }
  return { id_token: json.id_token };
}

/**
 * Validate ID token with jose when available; falls back to decode-only in tests
 * when JOSE_SKIP=1 (never use in production).
 */
export async function validateIdToken(i: {
  idToken: string;
  discovery: OidcDiscovery;
  clientId: string;
  expectedNonce?: string;
  /** When undefined, skip Continuity max_age freshness (normal Sign in). */
  maxAgeSecs?: number;
  attemptStartedAt?: number;
  clockToleranceSecs: number;
  nowSecs?: number;
}): Promise<ValidatedIdToken> {
  const now = i.nowSecs ?? Math.floor(Date.now() / 1000);
  let payload: Record<string, unknown>;

  if (process.env.WORLD_AUTH_JOSE_SKIP === "1") {
    payload = decodeJwtPayload(i.idToken);
  } else {
    const { createRemoteJWKSet, jwtVerify } = await import("jose");
    const jwks = createRemoteJWKSet(new URL(i.discovery.jwks_uri));
    const verified = await jwtVerify(i.idToken, jwks, {
      issuer: i.discovery.issuer,
      audience: i.clientId,
      clockTolerance: i.clockToleranceSecs,
    });
    payload = verified.payload as Record<string, unknown>;
  }

  const iss = String(payload.iss ?? "");
  const sub = String(payload.sub ?? "");
  if (!iss || !sub) {
    throw new WorldAuthError("invalid_token", "id_token missing iss/sub");
  }
  if (iss !== i.discovery.issuer) {
    throw new WorldAuthError("invalid_token", "issuer mismatch");
  }
  const aud = payload.aud;
  const audOk =
    aud === i.clientId ||
    (Array.isArray(aud) && aud.includes(i.clientId));
  if (!audOk) {
    throw new WorldAuthError("invalid_token", "audience mismatch");
  }

  if (i.expectedNonce && payload.nonce !== undefined && payload.nonce !== i.expectedNonce) {
    throw new WorldAuthError("invalid_token", "nonce mismatch");
  }

  const authTime = Number(payload.auth_time ?? payload.iat ?? 0);
  if (!Number.isFinite(authTime) || authTime <= 0) {
    throw new WorldAuthError("stale_auth", "id_token missing auth_time");
  }

  if (i.maxAgeSecs !== undefined) {
    const attemptStartedAt = i.attemptStartedAt ?? now;
    // Continuity: max_age=0 → auth must belong to this attempt (bounded lifetime).
    if (i.maxAgeSecs === 0) {
      if (authTime + i.clockToleranceSecs < attemptStartedAt) {
        throw new WorldAuthError("stale_auth", "auth_time before approval attempt");
      }
      if (authTime > now + i.clockToleranceSecs) {
        throw new WorldAuthError("stale_auth", "auth_time in the future");
      }
    } else {
      const age = now - authTime;
      if (age > i.maxAgeSecs + i.clockToleranceSecs) {
        throw new WorldAuthError(
          "stale_auth",
          `auth older than max_age=${i.maxAgeSecs}`,
        );
      }
    }
  }

  return {
    identity: { iss, sub },
    authTime,
    acr: typeof payload.acr === "string" ? payload.acr : undefined,
    amr: Array.isArray(payload.amr)
      ? payload.amr.map(String)
      : undefined,
    nonce: typeof payload.nonce === "string" ? payload.nonce : undefined,
    verificationLevel: verificationLevelFromClaims(payload),
    rawClaims: payload,
  };
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length < 2) {
    throw new WorldAuthError("invalid_token", "malformed jwt");
  }
  const json = Buffer.from(
    parts[1].replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf8");
  return JSON.parse(json) as Record<string, unknown>;
}

export function identitiesMatch(
  a: WorldIdentity | undefined,
  b: WorldIdentity,
): boolean {
  if (!a) return true;
  return a.iss === b.iss && a.sub === b.sub;
}

export function agentPassConfigSummary(cfg: WorldAuthConfig): string {
  return `issuer=${cfg.agentPass.issuer} client=${cfg.agentPass.clientId} max_age=${cfg.agentPass.maxAgeSecs}`;
}
