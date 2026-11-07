import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { McpHttpError } from "./mcp-client.js";

/** Mirror of live-store classifyLiveError (kept free of browser imports). */
function classifyLiveError(err: unknown): {
  kind: "unreachable" | "pot" | "mcp";
  message: string;
} {
  if (err instanceof McpHttpError) {
    if (err.status === 404 || err.status === 400 || err.status === 401) {
      return { kind: "pot", message: err.message };
    }
    return {
      kind: "mcp",
      message: err.message || `MCP HTTP ${err.status}`,
    };
  }
  if (err instanceof Error) {
    const msg = err.message || "request failed";
    if (
      err.name === "TypeError" ||
      /failed to fetch|network|econnrefused|load failed/i.test(msg)
    ) {
      return { kind: "unreachable", message: msg };
    }
    return { kind: "pot", message: msg };
  }
  return { kind: "unreachable", message: "MCP unreachable" };
}

describe("live load error classification", () => {
  it("treats Unknown pot 404 as pot error, not MCP unreachable", () => {
    const hit = classifyLiveError(
      new McpHttpError(404, { error: "Unknown pot" }),
    );
    assert.equal(hit.kind, "pot");
    assert.match(hit.message, /Unknown pot/i);
  });

  it("treats fetch failures as unreachable", () => {
    const err = new TypeError("Failed to fetch");
    assert.equal(classifyLiveError(err).kind, "unreachable");
  });

  it("treats 500 as mcp error", () => {
    assert.equal(
      classifyLiveError(new McpHttpError(500, { error: "boom" })).kind,
      "mcp",
    );
  });
});
