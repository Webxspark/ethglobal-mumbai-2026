import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { TEST_WORLD_KEYS } from "../../__tests__/testWorldKeys.js";
import { loadWorldAuthConfig } from "../../env/worldAuthConfig.js";
import { WorldAuthError } from "../../worldAuthTypes.js";
import {
  LOGIN_STATE_PREFIX,
  LoginOidcStore,
  beginLoginOidc,
  completeLoginOidc,
  isLoginOidcState,
  oidcLoginConfigured,
} from "./loginOidc.js";
import { verificationLevelFromClaims } from "./oidc.js";

describe("login OIDC", () => {
  const store = new LoginOidcStore();

  beforeEach(() => store.clear());

  it("reuses Agent Pass client when WORLD_OIDC_* unset", () => {
    const cfg = loadWorldAuthConfig({
      ...TEST_WORLD_KEYS,
      WORLD_AGENT_PASS_CLIENT_ID: "app_proofwork",
      WORLD_AGENT_PASS_CLIENT_SECRET: "secret",
      WORLD_AGENT_PASS_ISSUER: "https://auth.world.org",
      WORLD_AGENT_PASS_REDIRECT_URI:
        "https://pfw.alanchris.me/api/world/approve/callback",
    });
    assert.equal(cfg.oidc.clientId, "app_proofwork");
    assert.equal(cfg.oidc.clientSecret, "secret");
    assert.equal(cfg.oidc.issuer, "https://auth.world.org");
    assert.equal(
      cfg.oidc.redirectUri,
      "https://pfw.alanchris.me/api/world/approve/callback",
    );
    assert.equal(oidcLoginConfigured(cfg), true);
  });

  it("WORLD_OIDC_* overrides Agent Pass when set", () => {
    const cfg = loadWorldAuthConfig({
      ...TEST_WORLD_KEYS,
      WORLD_AGENT_PASS_CLIENT_ID: "app_agent",
      WORLD_AGENT_PASS_CLIENT_SECRET: "agent-secret",
      WORLD_OIDC_CLIENT_ID: "app_login",
      WORLD_OIDC_CLIENT_SECRET: "login-secret",
      WORLD_OIDC_ISSUER: "https://auth.world.org",
    });
    assert.equal(cfg.oidc.clientId, "app_login");
    assert.equal(cfg.oidc.clientSecret, "login-secret");
  });

  it("begin → complete with mocked discovery/token (JOSE_SKIP)", async () => {
    process.env.WORLD_AUTH_JOSE_SKIP = "1";
    const cfg = loadWorldAuthConfig({
      ...TEST_WORLD_KEYS,
      WORLD_AGENT_PASS_CLIENT_ID: "app_proofwork",
      WORLD_AGENT_PASS_CLIENT_SECRET: "secret",
      WORLD_AGENT_PASS_ISSUER: "https://auth.world.org",
      WORLD_AGENT_PASS_REDIRECT_URI: "http://127.0.0.1:38471/api/world/approve/callback",
    });

    const discovery = {
      issuer: "https://auth.world.org",
      authorization_endpoint: "https://auth.world.org/api/v1/authorize",
      token_endpoint: "https://auth.world.org/api/v1/token",
      jwks_uri: "https://auth.world.org/.well-known/jwks.json",
    };

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("openid-configuration")) {
        return new Response(JSON.stringify(discovery), { status: 200 });
      }
      if (url.includes("/token")) {
        // nonce is closed over after begin — see pendingNonce below
        const header = Buffer.from(
          JSON.stringify({ alg: "none", typ: "JWT" }),
        ).toString("base64url");
        const payload = Buffer.from(
          JSON.stringify({
            iss: "https://auth.world.org",
            sub: "oidc-sub-human-1",
            aud: "app_proofwork",
            iat: Math.floor(Date.now() / 1000),
            auth_time: Math.floor(Date.now() / 1000),
            nonce: pendingNonce,
            acr: "https://world.org/oidc/acr/orb",
          }),
        ).toString("base64url");
        return new Response(
          JSON.stringify({ id_token: `${header}.${payload}.sig` }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch ${url} ${init?.method}`);
    };

    let pendingNonce = "";
    const started = await beginLoginOidc({
      cfg,
      nextPath: "/owner/pot",
      store,
      fetchImpl,
    });
    const attempt = store.get(started.state);
    assert.ok(attempt);
    pendingNonce = attempt.nonce;
    assert.ok(started.authorizeUrl.includes("authorize"));
    assert.ok(isLoginOidcState(started.state));
    assert.ok(started.state.startsWith(LOGIN_STATE_PREFIX));
    const u = new URL(started.authorizeUrl);
    assert.equal(u.searchParams.get("code_challenge_method"), "S256");
    assert.ok(u.searchParams.get("code_challenge"));
    assert.equal(u.searchParams.get("scope"), "openid");
    assert.equal(u.searchParams.has("max_age"), false);

    const done = await completeLoginOidc({
      cfg,
      code: "auth-code",
      state: started.state,
      store,
      fetchImpl,
    });
    assert.equal(done.identity.sub, "oidc-sub-human-1");
    assert.equal(done.verificationLevel, "orb");
    assert.equal(done.nextPath, "/owner/pot");
    delete process.env.WORLD_AUTH_JOSE_SKIP;
  });

  it("rejects non-login state", async () => {
    const cfg = loadWorldAuthConfig({
      ...TEST_WORLD_KEYS,
      WORLD_AGENT_PASS_CLIENT_ID: "app_proofwork",
      WORLD_AGENT_PASS_CLIENT_SECRET: "secret",
    });
    await assert.rejects(
      () =>
        completeLoginOidc({
          cfg,
          code: "x",
          state: "appr_abc.xyz",
          store,
        }),
      (err: unknown) =>
        err instanceof WorldAuthError && err.code === "state_mismatch",
    );
  });

  it("clamps nextPath to same-origin relative", async () => {
    const cfg = loadWorldAuthConfig({
      ...TEST_WORLD_KEYS,
      WORLD_AGENT_PASS_CLIENT_ID: "app_proofwork",
      WORLD_AGENT_PASS_CLIENT_SECRET: "secret",
    });
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          authorization_endpoint: "https://auth.world.org/authorize",
          token_endpoint: "https://auth.world.org/token",
          jwks_uri: "https://auth.world.org/jwks",
          issuer: "https://auth.world.org",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const started = await beginLoginOidc({
      cfg,
      nextPath: "https://evil.example/phish",
      store,
      fetchImpl,
    });
    const attempt = store.get(started.state);
    assert.equal(attempt?.nextPath, "/owner/pot");
  });
});

describe("verificationLevelFromClaims", () => {
  it("maps acr orb / orb-face and legacy claim", () => {
    assert.equal(
      verificationLevelFromClaims({
        acr: "https://world.org/oidc/acr/orb",
      }),
      "orb",
    );
    assert.equal(
      verificationLevelFromClaims({
        acr: "https://world.org/oidc/acr/orb-face",
      }),
      "device",
    );
    assert.equal(
      verificationLevelFromClaims({
        "https://id.worldcoin.org/v1": { verification_level: "orb" },
      }),
      "orb",
    );
    assert.equal(verificationLevelFromClaims({}), "none");
  });
});
