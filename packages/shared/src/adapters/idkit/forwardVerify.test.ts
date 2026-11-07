import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { serializeIdKitVerifyBody } from "./forwardVerify.js";

describe("serializeIdKitVerifyBody", () => {
  it("forwards fields as-is including integrity_bundle", () => {
    const proof = {
      protocol_version: "4.0",
      nonce: "0xn",
      action: "proofwork-login",
      environment: "staging",
      integrity_bundle: {
        version: 2,
        signature_format: "apple_app_attest",
        timestamp: 99,
        signature: "ab",
        jwt: "eyJ",
      },
      responses: [{ identifier: "proof_of_human", nullifier: "0x1" }],
    };

    const { body, keys } = serializeIdKitVerifyBody(proof, "staging");
    assert.deepEqual(JSON.parse(body), proof);
    assert.ok(keys.includes("integrity_bundle"));
    assert.ok(keys.includes("nonce"));
    assert.ok(keys.includes("protocol_version"));
    assert.ok(keys.includes("responses"));
  });

  it("only fills environment when IDKit omitted it", () => {
    const proof = {
      protocol_version: "4.0",
      nonce: "0xn",
      action: "proofwork-login",
      responses: [{ identifier: "proof_of_human" }],
    };
    const { body } = serializeIdKitVerifyBody(proof, "staging");
    assert.equal(JSON.parse(body).environment, "staging");
    assert.equal(JSON.parse(body).nonce, "0xn");
  });
});
