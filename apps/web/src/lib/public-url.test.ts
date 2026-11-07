import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  publicUrl,
  resolvePublicOrigin,
  safeReturnTo,
} from "./public-url.js";

function req(headers: Record<string, string>, url = "http://0.0.0.0:38471/x") {
  return new Request(url, { headers });
}

describe("safeReturnTo", () => {
  it("keeps same-origin relative paths", () => {
    assert.equal(safeReturnTo("/owner/pot"), "/owner/pot");
    assert.equal(
      safeReturnTo("/worker/tasks?status=OPEN"),
      "/worker/tasks?status=OPEN",
    );
  });

  it("rejects open redirects", () => {
    assert.equal(safeReturnTo("//evil.example"), "/owner");
    assert.equal(safeReturnTo("https://evil.example/x"), "/owner");
    assert.equal(safeReturnTo("/\\evil"), "/owner");
    assert.equal(safeReturnTo("owner/pot"), "/owner");
  });
});

describe("publicUrl / resolvePublicOrigin", () => {
  it("prefers PROOFWORK_PUBLIC_URL over 0.0.0.0 request url", () => {
    const env = {
      PROOFWORK_PUBLIC_URL: "https://pfw.alanchris.me",
    };
    const r = req(
      { host: "0.0.0.0:38471" },
      "http://0.0.0.0:38471/api/world/approve/callback",
    );
    assert.equal(resolvePublicOrigin(r, env), "https://pfw.alanchris.me");
    assert.equal(
      publicUrl("/owner/pot", r, env),
      "https://pfw.alanchris.me/owner/pot",
    );
    assert.equal(
      publicUrl("/worker/tasks?status=OPEN", r, env),
      "https://pfw.alanchris.me/worker/tasks?status=OPEN",
    );
  });

  it("never sticks to 0.0.0.0 when a public URL is set", () => {
    const env = { PROOFWORK_PUBLIC_URL: "https://demo.example" };
    const r = req({ host: "0.0.0.0:38471" }, "http://0.0.0.0:38471/");
    const out = publicUrl("/", r, env);
    assert.ok(!out.includes("0.0.0.0"));
    assert.ok(!out.includes("127.0.0.1"));
    assert.equal(out, "https://demo.example/");
  });

  it("falls back to x-forwarded-proto + x-forwarded-host", () => {
    const env = {};
    const r = req(
      {
        host: "0.0.0.0:38471",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "tunnel.example",
      },
      "http://0.0.0.0:38471/login",
    );
    assert.equal(resolvePublicOrigin(r, env), "https://tunnel.example");
    assert.equal(
      publicUrl("/?next=%2Fowner%2Fpot", r, env),
      "https://tunnel.example/?next=%2Fowner%2Fpot",
    );
  });

  it("uses local configured URL when no tunnel headers", () => {
    const env = { PROOFWORK_PUBLIC_URL: "http://127.0.0.1:38471" };
    const r = req({ host: "0.0.0.0:38471" }, "http://0.0.0.0:38471/");
    // public URL is set (loopback) — still prefer it over bind address
    assert.equal(resolvePublicOrigin(r, env), "http://127.0.0.1:38471");
  });
});
