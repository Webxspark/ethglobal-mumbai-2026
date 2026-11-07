import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMockX402Gate } from "./mock.js";
import { defaultX402Env } from "./index.js";
import { serializeChallenge, buildRequirements } from "./requirements.js";

describe("x402 test double", () => {
  const env = defaultX402Env({
    port: 38472,
    payTo: "0.0.8000001",
    facilitatorUrl: "https://x402.org/facilitator",
  });
  const gate = createMockX402Gate(env);

  it("returns 402 challenge without X-PAYMENT", async () => {
    const d = await gate.decide({ tool: "post", headers: {} });
    assert.equal(d.kind, "challenge");
    if (d.kind !== "challenge") return;
    const body = JSON.parse(d.json) as {
      x402Version: number;
      accepts: { asset: string; network: string; maxAmountRequired: string }[];
    };
    assert.equal(body.x402Version, 1);
    assert.equal(body.accepts[0]?.asset, "0.0.6001");
    assert.equal(body.accepts[0]?.network, "hedera:testnet");
    assert.equal(body.accepts[0]?.maxAmountRequired, "10000");
  });

  it("accepts X-PAYMENT: mock", async () => {
    const d = await gate.decide({
      tool: "post",
      headers: { "x-payment": "mock" },
    });
    assert.equal(d.kind, "allow");
    if (d.kind !== "allow") return;
    assert.match(d.actor.receipt, /^mock-settle:post:/);
    assert.equal(d.responseHeader.name, "x-payment-response");
  });

  it("pins challenge bytes for snapshot demos", () => {
    const reqs = buildRequirements("post", env);
    const a = serializeChallenge(reqs, "X-PAYMENT header is required");
    const b = serializeChallenge(reqs, "X-PAYMENT header is required");
    assert.equal(a, b);
    assert.match(a, /0\.0\.8000001/);
  });
});
