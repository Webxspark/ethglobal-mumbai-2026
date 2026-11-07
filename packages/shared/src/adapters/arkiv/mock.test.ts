import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMockArkiv } from "./mock.js";
import { makeFixtureTask } from "../stubs.js";
import type { UnixSecs } from "../../types.js";

describe("mock Arkiv", () => {
  it("nearby returns geo tasks inside radius", async () => {
    const now = 1_700_000_000 as UnixSecs;
    const arkiv = createMockArkiv(() => now);
    const task = makeFixtureTask({
      geo: { lat: 19.076, lng: 72.877 },
      createdAt: now,
    });
    await arkiv.upsertTaskEntity(task);
    const near = await arkiv.nearby({
      lat: 19.076,
      lng: 72.877,
      radiusM: 5000,
    });
    assert.deepEqual(near, [task.id]);

    const far = await arkiv.nearby({
      lat: 28.6,
      lng: 77.2,
      radiusM: 1000,
    });
    assert.deepEqual(far, []);
  });

  it("skips entities without geo", async () => {
    const arkiv = createMockArkiv();
    const task = makeFixtureTask({ geo: null });
    await arkiv.upsertTaskEntity(task);
    const near = await arkiv.nearby({
      lat: 19.076,
      lng: 72.877,
      radiusM: 50_000,
    });
    assert.deepEqual(near, []);
  });
});
