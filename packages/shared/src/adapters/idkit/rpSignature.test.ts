import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadWorldAuthConfig } from "../../env/worldAuthConfig.js";
import { signIdKitRpRequest } from "./rpSignature.js";

describe("signIdKitRpRequest nonce freshness", () => {
  it("mints a distinct cryptographically random nonce per call", async () => {
    const cfg = loadWorldAuthConfig({
      WORLD_AGENT_PASS_CLIENT_ID: "test-agent-pass",
      WORLD_AGENT_PASS_CLIENT_SECRET: "test-secret",
      WORLD_IDKIT_APP_ID: "app_test",
      WORLD_IDKIT_RP_ID: "rp_test",
      WORLD_IDKIT_RP_SIGNING_KEY: "00".repeat(32),
    });

    const a = await signIdKitRpRequest({ cfg, action: "proofwork-login" });
    const b = await signIdKitRpRequest({ cfg, action: "proofwork-login" });
    const c = await signIdKitRpRequest({ cfg, action: null });

    assert.match(a.nonce, /^0x[0-9a-f]+$/i);
    assert.match(b.nonce, /^0x[0-9a-f]+$/i);
    assert.match(c.nonce, /^0x[0-9a-f]+$/i);

    assert.notEqual(a.nonce, b.nonce, "two uniqueness signatures must not share a nonce");
    assert.notEqual(a.nonce, c.nonce, "session signature must also get a fresh nonce");
    assert.notEqual(b.nonce, c.nonce);

    assert.ok(a.created_at > 0);
    assert.ok(a.expires_at > a.created_at);
    assert.ok(a.sig.startsWith("0x"));
  });
});
