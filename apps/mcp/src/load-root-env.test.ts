import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyEnvFile } from "./load-root-env.js";

describe("applyEnvFile", () => {
  it("fills missing keys and leaves existing alone", () => {
    const target: Record<string, string | undefined> = {
      KEEP: "shell",
    };
    const applied = applyEnvFile(
      [
        "# comment",
        "KEEP=from-file",
        "EXAMPLE_FLAG=1",
        "ARKIV_RPC_URL='https://example/ark_live_x'",
        "",
        "BAD LINE",
      ].join("\n"),
      target,
    );
    assert.equal(target.KEEP, "shell");
    assert.equal(target.EXAMPLE_FLAG, "1");
    assert.equal(target.ARKIV_RPC_URL, "https://example/ark_live_x");
    assert.deepEqual(applied.sort(), ["ARKIV_RPC_URL", "EXAMPLE_FLAG"]);
  });
});
