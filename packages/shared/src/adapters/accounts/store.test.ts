import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address, TaskId, UnixSecs, Wei } from "../../types.js";
import {
  createAccountBook,
  potIdFromNullifier,
  UnknownPotError,
} from "./store.js";

describe("account book", () => {
  it("one nullifier → one pot at 0 HBAR; re-ensure never credits", async () => {
    const book = createAccountBook(undefined, { persistPath: null });
    const first = book.ensureForNullifier("0xhuman-aaa");
    const again = book.ensureForNullifier("0xhuman-aaa");
    assert.equal(first.potId, again.potId);
    assert.equal(first.owner, again.owner);
    assert.equal(first.potId, potIdFromNullifier("0xhuman-aaa"));
    const empty = await book.status(first.potId);
    assert.equal(empty.balanceWei, 0n);
    const other = book.ensureForNullifier("0xhuman-bbb");
    assert.notEqual(first.potId, other.potId);
    assert.equal((await book.status(other.potId)).balanceWei, 0n);
    await book.deposit({
      potId: first.potId,
      amountWei: 1000n as Wei,
      owner: first.owner,
    });
    book.ensureForNullifier("0xhuman-aaa");
    const pot = await book.status(first.potId);
    assert.equal(pot.balanceWei, 1000n);
  });

  it("status throws UnknownPotError for missing pot (not a bare Error)", async () => {
    const book = createAccountBook(undefined, { persistPath: null });
    await assert.rejects(
      () => book.status("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as never),
      (err: unknown) => {
        assert.ok(err instanceof UnknownPotError);
        assert.equal(err.message, "Unknown pot");
        return true;
      },
    );
  });

  it("status requires potId", async () => {
    const book = createAccountBook(undefined, { persistPath: null });
    await assert.rejects(() => book.status("" as never), UnknownPotError);
  });

  it("persists pots across book reloads", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pw-accounts-"));
    const path = join(dir, "accounts.json");
    try {
      const a = createAccountBook(() => 1_700_000_000 as UnixSecs, {
        persistPath: path,
      });
      const row = a.ensureForNullifier("0xpersist-human");
      await a.deposit({
        potId: row.potId,
        amountWei: 5_000_000_000n as Wei,
        owner: row.owner,
      });
      assert.ok(readFileSync(path, "utf8").includes(row.potId));

      const b = createAccountBook(() => 1_700_000_100 as UnixSecs, {
        persistPath: path,
      });
      const again = b.ensureForNullifier("0xpersist-human");
      assert.equal(again.potId, row.potId);
      const pot = await b.status(row.potId);
      assert.equal(pot.balanceWei, 5_000_000_000n);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finalizePaidOut clears encumbrance and is idempotent per taskId", async () => {
    const book = createAccountBook(undefined, { persistPath: null });
    const row = book.ensureForNullifier("0xfinalize-human");
    await book.deposit({
      potId: row.potId,
      amountWei: 1_101_000_000n as Wei,
      owner: row.owner,
    });
    await book.withdraw({
      potId: row.potId,
      amountWei: 50_000_000n as Wei,
      owner: row.owner,
    });
    const encumbered = await book.status(row.potId);
    assert.equal(encumbered.spentWei, 50_000_000n);

    const taskId = "0xtaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01" as TaskId;
    await book.finalizePaidOut({
      potId: row.potId,
      amountWei: 50_000_000n as Wei,
      owner: row.owner,
      taskId,
    });
    let after = await book.status(row.potId);
    assert.equal(after.spentWei, 0n);

    await book.finalizePaidOut({
      potId: row.potId,
      amountWei: 50_000_000n as Wei,
      owner: row.owner,
      taskId,
    });
    after = await book.status(row.potId);
    assert.equal(after.spentWei, 0n);
  });

  it("finalizePaidOut does not throw when encumbrance missing (legacy post)", async () => {
    const book = createAccountBook(undefined, { persistPath: null });
    const row = book.ensureForNullifier("0xlegacy-encumb");
    const taskId = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb02" as TaskId;
    await book.finalizePaidOut({
      potId: row.potId,
      amountWei: 50_000_000n as Wei,
      owner: row.owner as Address,
      taskId,
    });
    const pot = await book.status(row.potId);
    assert.equal(pot.spentWei, 0n);
    await book.finalizePaidOut({
      potId: row.potId,
      amountWei: 50_000_000n as Wei,
      owner: row.owner,
      taskId,
    });
  });
});
