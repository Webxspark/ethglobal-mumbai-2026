import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  requireSessionPot,
  resolveFundCreditTarget,
} from "./session-pot.js";

describe("session pot binding", () => {
  const userPot = "0x57bf435489325cf717fc10e6e9870d07882f108a";
  const userOwner = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const userNullifier = "oidc-sub-user-1";

  it("requireSessionPot uses the session pot and does not invent ids", () => {
    const hit = requireSessionPot({
      authenticated: true,
      potId: userPot,
      owner: userOwner,
      nullifierHash: userNullifier,
    });
    assert.equal(hit.potId, userPot);
    assert.equal(hit.owner, userOwner);
  });

  it("requireSessionPot rejects missing session", () => {
    assert.throws(() => requireSessionPot(null), /Sign in with World ID/);
    assert.throws(
      () => requireSessionPot({ authenticated: false }),
      /Sign in with World ID/,
    );
    assert.throws(
      () =>
        requireSessionPot({
          authenticated: true,
          potId: "0xp0t000000000000000000000000000000000001",
          owner: userOwner,
          // missing nullifier
        }),
      /Sign in with World ID/,
    );
  });

  it("resolveFundCreditTarget binds session pot", () => {
    const session = {
      nullifierHash: userNullifier,
      potId: userPot as `0x${string}`,
      owner: userOwner as `0x${string}`,
      authMode: "live" as const,
      createdAt: 1,
    };
    const hit = resolveFundCreditTarget(session);
    assert.equal(hit.potId, userPot);
  });
});
