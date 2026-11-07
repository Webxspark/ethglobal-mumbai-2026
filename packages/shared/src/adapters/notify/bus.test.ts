import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  __resetNotifySeqForTests,
  createTaskNotifyBus,
} from "./bus.js";
import type { TaskId } from "../../types.js";

describe("task notify bus", () => {
  it("records events and wakes waiters", async () => {
    __resetNotifySeqForTests();
    const calls: { url: string; body: string }[] = [];
    const bus = createTaskNotifyBus({
      fetchImpl: (async (url, init) => {
        calls.push({
          url: String(url),
          body: String(init?.body ?? ""),
        });
        return new Response("ok", { status: 200 });
      }) as typeof fetch,
    });

    const taskId = "0xtasknotify0000000000000000000000000001" as TaskId;
    const waiting = bus.wait(taskId, 2_000);
    const ev = await bus.emit({
      taskId,
      event: "claimed",
      notifyUrl: "http://127.0.0.1:9/hook",
      payload: { worker: "0xabc" },
    });
    const woke = await waiting;
    assert.equal(woke?.event, "claimed");
    assert.equal(ev.task_id, taskId);
    await bus.flush();
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.body, /claimed/);
  });

  it("no-ops webhook when notify_url absent", async () => {
    __resetNotifySeqForTests();
    let hit = 0;
    const bus = createTaskNotifyBus({
      fetchImpl: (async () => {
        hit += 1;
        return new Response("ok");
      }) as typeof fetch,
    });
    const taskId = "0xtasknotify0000000000000000000000000002" as TaskId;
    await bus.emit({ taskId, event: "paid" });
    await bus.flush();
    assert.equal(hit, 0);
    assert.equal(bus.list(taskId).length, 1);
  });

  it("listSince / waitAny never lose events after a cursor", async () => {
    __resetNotifySeqForTests();
    const bus = createTaskNotifyBus();
    const a = "0xtasknotify00000000000000000000000000aa" as TaskId;
    const b = "0xtasknotify00000000000000000000000000bb" as TaskId;
    const e1 = await bus.emit({ taskId: a, event: "claimed" });
    const e2 = await bus.emit({ taskId: b, event: "message" });
    const e3 = await bus.emit({ taskId: a, event: "evidence_submitted" });
    assert.ok(e1.id < e2.id && e2.id < e3.id);

    const afterFirst = bus.listSince([a, b], e1.id);
    assert.deepEqual(
      afterFirst.map((e) => e.id),
      [e2.id, e3.id],
    );

    const waiting = bus.waitAny([a, b], 2_000, e3.id);
    const e4 = await bus.emit({ taskId: b, event: "expired" });
    const woke = await waiting;
    assert.equal(woke?.id, e4.id);
    const rest = bus.listSince([a, b], e3.id);
    assert.equal(rest.length, 1);
    assert.equal(rest[0]!.id, e4.id);
  });
});
