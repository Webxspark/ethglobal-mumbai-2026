import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, after } from "node:test";
import { createDiskAttachmentStore } from "./disk.js";

describe("disk attachment store", () => {
  let root = "";

  after(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("stores base64 and reads bytes back", async () => {
    root = await mkdtemp(path.join(tmpdir(), "pw-att-"));
    const store = createDiskAttachmentStore(root);
    const payload = Buffer.from("hello proofwork");
    const put = await store.put({
      filename: "note.txt",
      contentType: "text/plain",
      data: payload.toString("base64"),
    });
    assert.match(put.id, /^att_[a-f0-9]{64}$/);
    assert.equal(put.sha256, put.id.slice(4));
    assert.equal(put.size, payload.byteLength);
    const got = await store.get(put.id);
    assert.equal(got.bytes.toString("utf8"), "hello proofwork");
    assert.equal(got.meta.contentType, "text/plain");

    const again = await store.put({
      filename: "note-again.txt",
      contentType: "text/plain",
      data: payload.toString("base64"),
    });
    assert.equal(again.id, put.id, "same bytes → same sha256 id");
  });
});
