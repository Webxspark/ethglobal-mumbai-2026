import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatToolMcpContent } from "./mcp-bridge.js";

describe("formatToolMcpContent", () => {
  it("returns MCP image block for get_attachment", () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const out = formatToolMcpContent("get_attachment", {
      id: "att_x",
      contentType: "image/png",
      dataBase64: png.toString("base64"),
      mcpImage: { mimeType: "image/png", data: png.toString("base64") },
    });
    const image = out.content.find((c) => c.type === "image");
    assert.ok(image);
    assert.equal(image && "mimeType" in image ? image.mimeType : null, "image/png");
  });
});
