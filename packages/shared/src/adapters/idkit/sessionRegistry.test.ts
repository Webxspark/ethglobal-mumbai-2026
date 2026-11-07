import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createWorldSessionRegistry } from "./sessionRegistry.js";

describe("world session registry", () => {
  it("binds enrollment session → nullifier and rejects session_nullifier replay", () => {
    const reg = createWorldSessionRegistry({ persistPath: null });
    const sessionId = `session_${"ab".repeat(64)}`;
    const nullifier = "0x" + "11".repeat(32);

    const row = reg.bindEnrollment({ sessionId, nullifierHash: nullifier });
    assert.equal(reg.getBySession(sessionId)?.nullifierHash, nullifier);
    assert.equal(reg.getByNullifier(nullifier)?.sessionId, sessionId);
    assert.equal(row.sessionId, sessionId);

    // Rebinding same pair is idempotent; different session keeps the first.
    const again = reg.bindEnrollment({
      sessionId: `session_${"cd".repeat(64)}`,
      nullifierHash: nullifier,
    });
    assert.equal(again.sessionId, sessionId);

    assert.equal(reg.consumeSessionNullifier("0xsn1"), true);
    assert.equal(reg.consumeSessionNullifier("0xsn1"), false);
  });

  it("rehydrates bindings from disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "pw-world-sess-"));
    const path = join(dir, "sessions.json");
    try {
      const a = createWorldSessionRegistry({ persistPath: path });
      const sessionId = `session_${"ef".repeat(64)}`;
      const nullifier = "0x" + "22".repeat(32);
      a.bindEnrollment({ sessionId, nullifierHash: nullifier });
      a.consumeSessionNullifier("0xdisk-sn");

      const b = createWorldSessionRegistry({ persistPath: path });
      assert.equal(b.getBySession(sessionId)?.nullifierHash, nullifier);
      assert.equal(b.consumeSessionNullifier("0xdisk-sn"), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
