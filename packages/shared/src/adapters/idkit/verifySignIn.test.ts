import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TEST_WORLD_KEYS } from "../../__tests__/testWorldKeys.js";
import { loadWorldAuthConfig } from "../../env/worldAuthConfig.js";
import { WorldAuthError } from "../../worldAuthTypes.js";
import { createWorldSessionRegistry } from "./sessionRegistry.js";
import { verifyWorldSignIn } from "./verifySignIn.js";

const sessionId = `session_${"ab".repeat(64)}`;
const nullifier =
  "0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8";

describe("verifyWorldSignIn", () => {
  it("enrollment binds session_id → nullifier; session prove reuses it", async () => {
    const cfg = loadWorldAuthConfig({ ...TEST_WORLD_KEYS });
    const registry = createWorldSessionRegistry({ persistPath: null });

    const enrolled = await verifyWorldSignIn({
      cfg,
      registry,
      proof: {
        protocol_version: "4.0",
        action: "proofwork-login",
        session_id: sessionId,
        environment: "stub",
        responses: [
          {
            identifier: "proof_of_human",
            nullifier,
            issuer_schema_id: 1,
          },
        ],
      },
    });

    assert.equal(enrolled.kind, "enrollment");
    assert.equal(enrolled.nullifierHash, nullifier);
    assert.equal(enrolled.sessionId, sessionId);

    const returned = await verifyWorldSignIn({
      cfg,
      registry,
      proof: {
        protocol_version: "4.0",
        session_id: sessionId,
        environment: "stub",
        responses: [
          {
            identifier: "proof_of_human",
            session_nullifier: ["0xsn-fresh", "0xaction"],
            issuer_schema_id: 1,
          },
        ],
      },
    });

    assert.equal(returned.kind, "session");
    assert.equal(returned.nullifierHash, nullifier);
    assert.equal(returned.sessionId, sessionId);

    await assert.rejects(
      () =>
        verifyWorldSignIn({
          cfg,
          registry,
          proof: {
            protocol_version: "4.0",
            session_id: sessionId,
            environment: "stub",
            responses: [
              {
                identifier: "proof_of_human",
                session_nullifier: ["0xsn-fresh", "0xaction"],
                issuer_schema_id: 1,
              },
            ],
          },
        }),
      (err: unknown) =>
        err instanceof WorldAuthError &&
        /session_nullifier_replayed/.test(err.message),
    );
  });

  it("live path forwards payload to portal and maps session prove", async () => {
    const cfg = loadWorldAuthConfig({ ...TEST_WORLD_KEYS });
    const registry = createWorldSessionRegistry({ persistPath: null });
    registry.bindEnrollment({ sessionId, nullifierHash: nullifier });

    const proof = {
      protocol_version: "4.0",
      nonce: "0xabc123",
      session_id: sessionId,
      environment: "staging",
      integrity_bundle: {
        version: 2,
        signature_format: "apple_app_attest",
        timestamp: 1_788_302_923,
        signature: "a1b2c3d4",
        jwt: "eyJ...",
      },
      responses: [
        {
          identifier: "proof_of_human",
          session_nullifier: ["0xaaa", "0xbbb"],
          issuer_schema_id: 1,
        },
      ],
    };

    const calls: unknown[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls.push(init?.body ? JSON.parse(String(init.body)) : null);
      return new Response(
        JSON.stringify({
          success: true,
          environment: "staging",
          session_id: sessionId,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const result = await verifyWorldSignIn({
      cfg,
      registry,
      fetchImpl,
      proof,
    });

    assert.equal(result.nullifierHash, nullifier);
    assert.equal(result.kind, "session");
    assert.equal(calls.length, 1);
    const forwarded = calls[0] as Record<string, unknown>;
    assert.deepEqual(forwarded, proof);
    assert.ok(forwarded.integrity_bundle);
    assert.equal("signal" in forwarded, false);
  });

  it("recovers returning login from registry when signup already completed", async () => {
    const cfg = loadWorldAuthConfig({
      ...TEST_WORLD_KEYS,
      WORLD_IDKIT_SIGNIN_ACTION: "proofwork-login",
    });
    const registry = createWorldSessionRegistry({ persistPath: null });
    registry.bindEnrollment({ sessionId, nullifierHash: nullifier });

    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          success: false,
          code: "nullifier_replayed",
          detail: "already verified",
          nullifier,
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );

    const result = await verifyWorldSignIn({
      cfg,
      registry,
      fetchImpl,
      expectedAction: "proofwork-login",
      proof: {
        protocol_version: "4.0",
        action: "proofwork-login",
        session_id: "create",
        environment: "staging",
        responses: [
          {
            identifier: "proof_of_human",
            nullifier,
            issuer_schema_id: 1,
          },
        ],
      },
    });

    assert.equal(result.kind, "session");
    assert.equal(result.sessionId, sessionId);
    assert.equal(result.nullifierHash, nullifier);
  });

  it("surfaces signup_already_completed when action burned with no session binding", async () => {
    const cfg = loadWorldAuthConfig({ ...TEST_WORLD_KEYS });
    const registry = createWorldSessionRegistry({ persistPath: null });

    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          success: false,
          code: "nullifier_replayed",
          detail: "already completed",
          nullifier,
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );

    await assert.rejects(
      () =>
        verifyWorldSignIn({
          cfg,
          registry,
          fetchImpl,
          proof: {
            protocol_version: "4.0",
            action: "proofwork-login",
            session_id: "create",
            environment: "staging",
            responses: [
              {
                identifier: "proof_of_human",
                nullifier,
                issuer_schema_id: 1,
              },
            ],
          },
        }),
      (err: unknown) =>
        err instanceof WorldAuthError &&
        err.code === "signup_already_completed",
    );
  });
});
