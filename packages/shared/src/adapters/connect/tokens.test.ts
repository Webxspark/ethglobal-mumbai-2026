import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address, PotId, UnixSecs, Wei } from "../../types.js";
import {
  ConnectAuthError,
  createConnectTokenStore,
  extractConnectToken,
} from "./tokens.js";

const pot = "0xp0t000000000000000000000000000000000001" as PotId;
const owner = "0x0000000000000000000000000000000000000a11" as Address;

describe("connect tokens", () => {
  it("mints and resolves before expiry", () => {
    let t = 1_700_000_000 as UnixSecs;
    const store = createConnectTokenStore(() => t, { persistPath: null });
    const rec = store.mint({
      potId: pot,
      owner,
      notifyUrl: "http://127.0.0.1:9999/hook",
      maxBountyWei: 50000n as Wei,
      ttlSecs: 120,
      label: "opencode desk",
    });
    assert.match(rec.token, /^pwct_/);
    assert.equal(rec.potId, pot);
    const session = store.resolve(rec.token);
    assert.equal(session.potId, pot);
    assert.equal(session.notifyUrl, "http://127.0.0.1:9999/hook");
    assert.equal(session.maxBountyWei, 50000n);
  });

  it("rejects unknown and expired", () => {
    let t = 1_700_000_000 as UnixSecs;
    const store = createConnectTokenStore(() => t, { persistPath: null });
    const rec = store.mint({ potId: pot, owner, ttlSecs: 60, token: "pwct_fixed" });
    assert.throws(
      () => store.resolve("pwct_nope"),
      (e: unknown) => e instanceof ConnectAuthError,
    );
    t = (t + 61) as UnixSecs;
    assert.throws(
      () => store.resolve(rec.token),
      (e: unknown) =>
        e instanceof ConnectAuthError && /expired|unknown/.test(e.message),
    );
  });

  it("persists across store restarts", () => {
    const dir = mkdtempSync(join(tmpdir(), "pwct-"));
    const path = join(dir, "connect-tokens.json");
    let t = 1_700_000_000 as UnixSecs;
    const a = createConnectTokenStore(() => t, { persistPath: path });
    const rec = a.mint({
      potId: pot,
      owner,
      ttlSecs: 600,
      token: "pwct_persist_me",
      nullifierHash: "0xpersist",
    });
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      tokens: { token: string }[];
    };
    assert.equal(raw.tokens[0]?.token, rec.token);

    const b = createConnectTokenStore(() => t, { persistPath: path });
    const session = b.resolve("pwct_persist_me");
    assert.equal(session.potId, pot);
    assert.equal(session.nullifierHash, "0xpersist");
  });

  it("extracts bearer and X-PROOFWORK-CONNECT", () => {
    assert.equal(
      extractConnectToken({ authorization: "Bearer pwct_abc" }),
      "pwct_abc",
    );
    assert.equal(
      extractConnectToken({ "X-PROOFWORK-CONNECT": "pwct_hdr" }),
      "pwct_hdr",
    );
    assert.equal(
      extractConnectToken({
        authorization: "Bearer ignored",
        "x-proofwork-connect": "pwct_wins",
      }),
      "pwct_wins",
    );
    assert.equal(extractConnectToken({}), null);
  });
});
