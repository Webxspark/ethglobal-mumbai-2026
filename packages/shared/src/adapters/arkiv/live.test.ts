import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accessKeyFromRpcUrl } from "./live.js";

describe("arkiv live helpers", () => {
  it("pulls ark_ access key from RPC path", () => {
    assert.equal(
      accessKeyFromRpcUrl(
        "https://rpc.rabdi.db-chain.testnet.arkiv.network/ark_live_abc123",
      ),
      "ark_live_abc123",
    );
  });

  it("returns empty when URL has no ark_ segment", () => {
    assert.equal(
      accessKeyFromRpcUrl(
        "https://rpc.rabdi.db-chain.testnet.arkiv.network",
      ),
      "",
    );
  });
});
