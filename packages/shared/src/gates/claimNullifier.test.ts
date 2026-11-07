import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertOrBindClaimNullifier,
  type ClaimNullifierStore,
} from "./claimNullifier.js";
import { WorldAuthError } from "../worldAuthTypes.js";

function memoryStore(): ClaimNullifierStore {
  const byAccount = new Map<string, string>();
  const byClaim = new Map<string, string>();
  return {
    getByAccount(k) {
      return byAccount.get(k.trim()) ?? null;
    },
    getAccountForClaimNullifier(nf) {
      return byClaim.get(nf.trim()) ?? null;
    },
    bind(i) {
      const accountKey = i.accountKey.trim();
      const claimNullifier = i.claimNullifier.trim();
      byAccount.set(accountKey, claimNullifier);
      byClaim.set(claimNullifier, accountKey);
      return { accountKey, claimNullifier, boundAt: Date.now() };
    },
  };
}

describe("assertOrBindClaimNullifier", () => {
  it("binds on first verify", () => {
    const store = memoryStore();
    const hit = assertOrBindClaimNullifier(store, "sub-a", "0xpoh-a");
    assert.equal(hit.firstBind, true);
    assert.equal(store.getByAccount("sub-a"), "0xpoh-a");
  });

  it("allows replay for same account", () => {
    const store = memoryStore();
    assertOrBindClaimNullifier(store, "sub-a", "0xpoh-a");
    const again = assertOrBindClaimNullifier(store, "sub-a", "0xpoh-a");
    assert.equal(again.firstBind, false);
  });

  it("blocks mismatch on same account", () => {
    const store = memoryStore();
    assertOrBindClaimNullifier(store, "sub-a", "0xpoh-a");
    assert.throws(
      () => assertOrBindClaimNullifier(store, "sub-a", "0xpoh-other"),
      (err: unknown) =>
        err instanceof WorldAuthError &&
        err.message === "claim_nullifier_mismatch",
    );
  });

  it("blocks when nullifier belongs to another account", () => {
    const store = memoryStore();
    assertOrBindClaimNullifier(store, "sub-a", "0xpoh-shared");
    assert.throws(
      () => assertOrBindClaimNullifier(store, "sub-b", "0xpoh-shared"),
      (err: unknown) =>
        err instanceof WorldAuthError &&
        err.message === "claim_nullifier_other_account",
    );
  });
});
