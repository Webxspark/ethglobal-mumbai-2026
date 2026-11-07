import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractDocumentText,
  isImageMime,
} from "./attachment-media.js";

describe("attachment-media", () => {
  it("detects image mime and extensions", () => {
    assert.equal(isImageMime("image/png", "x.bin"), true);
    assert.equal(isImageMime("application/octet-stream", "photo.heic"), true);
    assert.equal(isImageMime("text/plain", "readme.txt"), false);
  });

  it("extracts utf8 text docs", () => {
    const text = extractDocumentText(
      "text/plain",
      Buffer.from("hello **world**", "utf8"),
    );
    assert.equal(text, "hello **world**");
  });
});
