import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLiveX402Gate } from "./live.js";
import { createMockX402Gate } from "./mock.js";
import { defaultX402Env } from "./index.js";
import { buildRequirements } from "./requirements.js";

describe("live x402 gate", () => {
  const env = defaultX402Env({
    port: 38472,
    payTo: "0.0.11337148",
    facilitatorUrl: "https://x402.org/facilitator",
  });
  const gate = createLiveX402Gate(env);

  it("rejects literal X-PAYMENT: mock without mentioning mock mode or USDC", async () => {
    const d = await gate.decide({
      tool: "post",
      headers: { "x-payment": "mock" },
    });
    assert.equal(d.kind, "challenge");
    if (d.kind !== "challenge") return;
    assert.equal(d.status, 402);
    const body = JSON.parse(d.json) as {
      error: string;
      accepts: { extra?: { name?: string }; payTo?: string }[];
    };
    assert.equal(body.error, "invalid X-PAYMENT payload");
    assert.doesNotMatch(body.error, /mock mode|PROOFWORK_X402_MODE|USDC/i);
    assert.doesNotMatch(d.json, /USDC/);
    assert.notEqual(body.accepts[0]?.extra?.name, "USDC");
  });

  it("does not advise mock mode or USDC when settle is unwired", async () => {
    const d = await gate.decide({
      tool: "cancel",
      headers: { "x-payment": "e30=" },
    });
    assert.equal(d.kind, "challenge");
    if (d.kind !== "challenge") return;
    const body = JSON.parse(d.json) as { error: string };
    assert.equal(body.error, "payment settlement unavailable");
    assert.doesNotMatch(body.error, /PROOFWORK_X402_MODE|mock|USDC/i);
  });

  it("still challenges when X-PAYMENT is missing", async () => {
    const d = await gate.decide({ tool: "post", headers: {} });
    assert.equal(d.kind, "challenge");
    if (d.kind !== "challenge") return;
    const body = JSON.parse(d.json) as { error: string };
    assert.equal(body.error, "X-PAYMENT header is required");
    assert.doesNotMatch(body.error, /USDC|mock mode|PROOFWORK_X402_MODE/i);
  });

  it("labels challenge extras as HBAR, not USDC", () => {
    const reqs = buildRequirements("post", env);
    assert.equal(reqs.extra.name, "HBAR");
    assert.notEqual(reqs.extra.name, "USDC");
  });
});

describe("x402 test double (mock.ts) still allows mock shortcut", () => {
  it("accepts X-PAYMENT: mock via injected double", async () => {
    const mockGate = createMockX402Gate(
      defaultX402Env({
        port: 38472,
        payTo: "0.0.8000001",
        facilitatorUrl: "https://x402.org/facilitator",
      }),
    );
    const allowed = await mockGate.decide({
      tool: "post",
      headers: { "X-PAYMENT": "mock" },
    });
    assert.equal(allowed.kind, "allow");
  });
});
