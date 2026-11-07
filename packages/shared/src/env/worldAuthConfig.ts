export type WorldAuthConfig = {
  /** Public base URL of the web app (Continuity / OIDC redirects). */
  publicAppUrl: string;
  agentPass: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    issuer: string;
    /** Default Continuity freshness: 0 = fresh auth each approval. */
    maxAgeSecs: number;
    /** Approval inbox TTL (seconds). */
    approvalTtlSecs: number;
    /** Clock skew tolerance for auth_time checks. */
    clockToleranceSecs: number;
  };
  /**
   * Sign in with World ID (OIDC). Defaults reuse Agent Pass client +
   * shared `/api/world/approve/callback` redirect — no extra env required.
   * Optional WORLD_OIDC_* overrides when set.
   */
  oidc: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    /** Default https://auth.world.org */
    issuer: string;
    clockToleranceSecs: number;
  };
  idkit: {
    appId: string;
    rpId: string;
    /** Worker-accept uniqueness action — gig PoH only. */
    action: string;
    /** @deprecated Login no longer uses IDKit; kept for status surfaces. */
    signinAction: string;
    /** Hex signing key — server only; never ship to client. */
    rpSigningKey: string;
    environment: "staging" | "production";
    verifyBaseUrl: string;
  };
};

function pick(env: NodeJS.Dict<string>, key: string, fallback = ""): string {
  return (env[key] ?? fallback).trim();
}

function pickInt(env: NodeJS.Dict<string>, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function requireKey(env: NodeJS.Dict<string>, key: string): string {
  const v = pick(env, key);
  if (!v) {
    throw new Error(`proofwork boot: World auth missing required env: ${key}`);
  }
  return v;
}

/**
 * Parse env into World auth config. Always live — no stub/mode switch.
 * Missing Continuity / IDKit keys fail loudly.
 */
export function loadWorldAuthConfig(
  env: NodeJS.Dict<string> = process.env,
): WorldAuthConfig {
  const publicAppUrl = pick(
    env,
    "PROOFWORK_PUBLIC_URL",
    "http://127.0.0.1:38471",
  );
  const agentClientId = requireKey(env, "WORLD_AGENT_PASS_CLIENT_ID");
  const agentClientSecret = requireKey(env, "WORLD_AGENT_PASS_CLIENT_SECRET");
  const agentRedirectUri = pick(
    env,
    "WORLD_AGENT_PASS_REDIRECT_URI",
    `${publicAppUrl.replace(/\/$/, "")}/api/world/approve/callback`,
  );
  const agentIssuer = pick(
    env,
    "WORLD_AGENT_PASS_ISSUER",
    "https://auth.world.org",
  );
  const clockToleranceSecs = pickInt(
    env,
    "WORLD_AGENT_PASS_CLOCK_TOLERANCE",
    30,
  );

  const idkitAppId = requireKey(env, "WORLD_IDKIT_APP_ID");
  const idkitRpId = requireKey(env, "WORLD_IDKIT_RP_ID");
  const idkitRpSigningKey = requireKey(env, "WORLD_IDKIT_RP_SIGNING_KEY");

  return {
    publicAppUrl,
    agentPass: {
      clientId: agentClientId,
      clientSecret: agentClientSecret,
      redirectUri: agentRedirectUri,
      issuer: agentIssuer,
      maxAgeSecs: pickInt(env, "WORLD_AGENT_PASS_MAX_AGE", 0),
      approvalTtlSecs: pickInt(env, "WORLD_AGENT_PASS_APPROVAL_TTL", 600),
      clockToleranceSecs,
    },
    oidc: {
      clientId: pick(env, "WORLD_OIDC_CLIENT_ID") || agentClientId,
      clientSecret: pick(env, "WORLD_OIDC_CLIENT_SECRET") || agentClientSecret,
      redirectUri:
        pick(env, "WORLD_OIDC_REDIRECT_URI") ||
        agentRedirectUri ||
        `${publicAppUrl.replace(/\/$/, "")}/api/world/approve/callback`,
      issuer: pick(env, "WORLD_OIDC_ISSUER") || agentIssuer,
      clockToleranceSecs,
    },
    idkit: {
      appId: idkitAppId,
      rpId: idkitRpId,
      action:
        pick(env, "WORLD_IDKIT_ACCEPT_ACTION") ||
        pick(env, "WORLD_IDKIT_ACTION", "proofwork-accept"),
      signinAction: pick(env, "WORLD_IDKIT_SIGNIN_ACTION", "proofwork-login"),
      rpSigningKey: idkitRpSigningKey,
      environment:
        pick(env, "WORLD_IDKIT_ENVIRONMENT", "production") === "staging"
          ? "staging"
          : "production",
      verifyBaseUrl: pick(
        env,
        "WORLD_IDKIT_VERIFY_BASE_URL",
        "https://developer.world.org/api/v4/verify",
      ),
    },
  };
}
