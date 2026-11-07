import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withTimeout } from "./with-timeout.js";

describe("withTimeout", () => {
  it("resolves when work finishes in time", async () => {
    const v = await withTimeout(Promise.resolve(42), 200, "fast");
    assert.equal(v, 42);
  });

  it("rejects when work hangs", async () => {
    await assert.rejects(
      () =>
        withTimeout(
          new Promise(() => {
            /* never */
          }),
          40,
          "hang",
        ),
      /hang timed out after 40ms/,
    );
  });
});
