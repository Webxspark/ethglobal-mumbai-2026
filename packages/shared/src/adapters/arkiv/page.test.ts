import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_LIMIT } from "@arkiv-network/sdk/query";
import {
  assertArkivLimit,
  mergeArkivPages,
  type ArkivQueryPage,
} from "./page.js";

describe("arkiv page helper", () => {
  it("rejects limits above the node maximum", () => {
    assert.throws(
      () => assertArkivLimit(MAX_LIMIT + 1),
      /exceeds the node maximum/,
    );
  });

  it("pages with offset until a short page and dedupes", async () => {
    const calls: { limit: number; offset: number }[] = [];
    const pages: ArkivQueryPage<{ id: string }>[] = [
      {
        entities: [{ id: "a" }, { id: "b" }],
        skipped: 0,
      },
      {
        entities: [{ id: "a" }, { id: "c" }],
        skipped: 0,
      },
    ];

    const merged = await mergeArkivPages(
      async (limit, offset) => {
        calls.push({ limit, offset });
        assert.ok(limit <= MAX_LIMIT);
        const page = pages.shift();
        if (!page) {
          return { entities: [], skipped: 0 };
        }
        return page;
      },
      { pageSize: 2, maxEntities: 10, dedupeKey: (r) => r.id },
    );

    assert.deepEqual(calls, [
      { limit: 2, offset: 0 },
      { limit: 2, offset: 2 },
      { limit: 2, offset: 4 },
    ]);
    assert.deepEqual(merged.map((r) => r.id), ["a", "b", "c"]);
  });
});
