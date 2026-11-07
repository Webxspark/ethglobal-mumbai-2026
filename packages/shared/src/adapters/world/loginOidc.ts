import type { UnixSecs } from "../../types.js";
import type { WorldAuthConfig } from "../../env/worldAuthConfig.js";
import type { WorldIdentity } from "../../worldAuthTypes.js";
import { WorldAuthError } from "../../worldAuthTypes.js";
import {
  buildAuthorizeUrl,
  exchangeCode,
  fetchDiscovery,
  pkceChallenge,
  randomToken,
  validateIdToken,
  type VerificationLevel,
} from "./oidc.js";

/** Callback state prefix — shared redirect with Agent Pass (`appr_…`). */
export const LOGIN_STATE_PREFIX = "login.";

export type LoginOidcAttempt = {
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  nextPath: string;
  startedAt: UnixSecs;
  expiresAt: UnixSecs;
};

export type BeginLoginOidcResult = {
  authorizeUrl: string;
  state: string;
  expiresAt: UnixSecs;
};

export type CompleteLoginOidcResult = {
  identity: WorldIdentity;
  authTime: number;
  verificationLevel: VerificationLevel;
  acr?: string;
  nextPath: string;
};

function nowSecs(): UnixSecs {
  return Math.floor(Date.now() / 1000) as UnixSecs;
}

/** Process-local login attempt inbox (PKCE + nonce). */
export class LoginOidcStore {
  private readonly byState = new Map<string, LoginOidcAttempt>();

  put(attempt: LoginOidcAttempt): void {
    this.byState.set(attempt.state, attempt);
  }

  take(state: string): LoginOidcAttempt | undefined {
    const hit = this.byState.get(state);
    if (hit) this.byState.delete(state);
    return hit;
  }

  get(state: string): LoginOidcAttempt | undefined {
    return this.byState.get(state);
  }

  clear(): void {
    this.byState.clear();
  }
}

export const sharedLoginOidcStore = new LoginOidcStore();

export function isLoginOidcState(state: string | null | undefined): boolean {
  return typeof state === "string" && state.startsWith(LOGIN_STATE_PREFIX);
}

function safeNextPath(raw: string | null | undefined): string {
  const fallback = "/owner/pot";
  const next = (raw ?? "").trim() || fallback;
  // Same-origin relative only — no scheme, no protocol-relative, no escapes.
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  if (next.includes("://") || next.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  return next;
}

export function oidcLoginConfigured(cfg: WorldAuthConfig): boolean {
  const id = cfg.oidc.clientId.trim();
  if (!id || id.startsWith("app_stub") || id === "stub") return false;
  return cfg.oidc.clientSecret.trim().length > 0;
}

/** Start Sign in with World ID — authorization-code + state/nonce + PKCE S256. */
export async function beginLoginOidc(i: {
  cfg: WorldAuthConfig;
  nextPath?: string | null;
  store?: LoginOidcStore;
  fetchImpl?: typeof fetch;
  ttlSecs?: number;
}): Promise<BeginLoginOidcResult> {
  if (!oidcLoginConfigured(i.cfg)) {
    throw new WorldAuthError(
      "invalid_token",
      "World OIDC client not configured (WORLD_AGENT_PASS_CLIENT_ID/SECRET)",
    );
  }
  const store = i.store ?? sharedLoginOidcStore;
  const fetchImpl = i.fetchImpl ?? fetch;
  const discovery = await fetchDiscovery(i.cfg.oidc.issuer, fetchImpl);
  const startedAt = nowSecs();
  const ttl = i.ttlSecs ?? 600;
  const expiresAt = (startedAt + ttl) as UnixSecs;
  const state = `${LOGIN_STATE_PREFIX}${randomToken(16)}`;
  const nonce = randomToken(16);
  const codeVerifier = randomToken(32);
  const redirectUri = i.cfg.oidc.redirectUri;
  const authorizeUrl = buildAuthorizeUrl({
    discovery,
    clientId: i.cfg.oidc.clientId,
    redirectUri,
    state,
    nonce,
    codeChallenge: pkceChallenge(codeVerifier),
  });

  store.put({
    state,
    nonce,
    codeVerifier,
    redirectUri,
    nextPath: safeNextPath(i.nextPath),
    startedAt,
    expiresAt,
  });

  return { authorizeUrl, state, expiresAt };
}

/** Finish Sign in after shared `/api/world/approve/callback` redirect. */
export async function completeLoginOidc(i: {
  cfg: WorldAuthConfig;
  code: string;
  state: string;
  store?: LoginOidcStore;
  fetchImpl?: typeof fetch;
}): Promise<CompleteLoginOidcResult> {
  if (!isLoginOidcState(i.state)) {
    throw new WorldAuthError("state_mismatch", "not a login OIDC state");
  }
  const store = i.store ?? sharedLoginOidcStore;
  const attempt = store.take(i.state);
  if (!attempt) {
    throw new WorldAuthError("invalid_token", "unknown or expired login state");
  }
  if (nowSecs() > attempt.expiresAt) {
    throw new WorldAuthError("approval_expired", "login attempt expired");
  }
  if (attempt.state !== i.state) {
    throw new WorldAuthError("state_mismatch");
  }

  const fetchImpl = i.fetchImpl ?? fetch;
  const discovery = await fetchDiscovery(i.cfg.oidc.issuer, fetchImpl);
  const tokens = await exchangeCode({
    discovery,
    clientId: i.cfg.oidc.clientId,
    clientSecret: i.cfg.oidc.clientSecret,
    code: i.code,
    redirectUri: attempt.redirectUri,
    codeVerifier: attempt.codeVerifier,
    fetchImpl,
  });

  const validated = await validateIdToken({
    idToken: tokens.id_token,
    discovery,
    clientId: i.cfg.oidc.clientId,
    expectedNonce: attempt.nonce,
    clockToleranceSecs: i.cfg.oidc.clockToleranceSecs,
  });

  return {
    identity: validated.identity,
    authTime: validated.authTime,
    verificationLevel: validated.verificationLevel,
    acr: validated.acr,
    nextPath: attempt.nextPath,
  };
}
