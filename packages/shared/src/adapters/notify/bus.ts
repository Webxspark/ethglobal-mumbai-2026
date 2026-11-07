import { randomBytes } from "node:crypto";
import type { TaskId, TaskNotifyEvent, TaskNotifyKind } from "../../types.js";

export type NotifyEmitInput = {
  taskId: TaskId;
  event: TaskNotifyKind;
  notifyUrl?: string | null;
  payload?: Record<string, unknown>;
};

type Waiter = {
  /** null = wait on any of taskIds */
  taskId: TaskId | null;
  taskIds: Set<string> | null;
  afterId: string | null;
  resolve: (ev: TaskNotifyEvent | null) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type TaskNotifyBus = {
  emit(i: NotifyEmitInput): Promise<TaskNotifyEvent>;
  list(taskId: TaskId): TaskNotifyEvent[];
  /** Events for many tasks with id strictly after `afterId`, oldest first. */
  listSince(taskIds: TaskId[], afterId?: string | null): TaskNotifyEvent[];
  wait(
    taskId: TaskId,
    timeoutMs: number,
    afterId?: string | null,
  ): Promise<TaskNotifyEvent | null>;
  /**
   * Long-poll until any event on the given tasks after `afterId`.
   * Returns the first new event (caller should listSince for the full batch).
   */
  waitAny(
    taskIds: TaskId[],
    timeoutMs: number,
    afterId?: string | null,
  ): Promise<TaskNotifyEvent | null>;
  /** Test helper — flush pending webhook promises. */
  flush(): Promise<void>;
};

function isoNow(): string {
  return new Date().toISOString();
}

/** Monotonic ids so cursor (`after_id`) never skips events. */
let seq = 0;
function newId(): string {
  seq += 1;
  return `nev_${String(seq).padStart(12, "0")}_${randomBytes(3).toString("hex")}`;
}

/** Test helper — reset monotonic counter between suites. */
export function __resetNotifySeqForTests(): void {
  seq = 0;
}

/**
 * In-process event log + best-effort HTTPS webhooks for posting agents.
 * Missing notify_url → record only (Review inbox demo still works).
 */
export function createTaskNotifyBus(
  opts: { fetchImpl?: typeof fetch; log?: (msg: string) => void } = {},
): TaskNotifyBus {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  const log = opts.log ?? ((msg) => console.warn(`[notify] ${msg}`));
  const byTask = new Map<string, TaskNotifyEvent[]>();
  const waiters: Waiter[] = [];
  const pendingHooks: Promise<void>[] = [];

  function collectSince(
    taskIds: Iterable<string>,
    afterId: string | null,
  ): TaskNotifyEvent[] {
    const out: TaskNotifyEvent[] = [];
    for (const id of taskIds) {
      for (const ev of byTask.get(id) ?? []) {
        if (afterId && !(ev.id > afterId)) continue;
        out.push(ev);
      }
    }
    out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return out;
  }

  function wakeMatching(ev: TaskNotifyEvent) {
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i]!;
      if (w.taskId != null && w.taskId !== ev.task_id) continue;
      if (w.taskIds && !w.taskIds.has(ev.task_id)) continue;
      if (w.afterId && !(ev.id > w.afterId)) continue;
      clearTimeout(w.timer);
      waiters.splice(i, 1);
      w.resolve(ev);
    }
  }

  function append(ev: TaskNotifyEvent) {
    const rows = byTask.get(ev.task_id) ?? [];
    rows.push(ev);
    byTask.set(ev.task_id, rows);
    wakeMatching(ev);
  }

  async function postWebhook(url: string, body: TaskNotifyEvent) {
    if (!fetchImpl) {
      log(`no fetch; skipped webhook → ${url}`);
      return;
    }
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(4_000),
      });
      if (!res.ok) {
        log(`webhook ${res.status} for ${body.event} → ${url}`);
      }
    } catch (err) {
      log(
        `webhook failed for ${body.event}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    async emit(i) {
      const ev: TaskNotifyEvent = {
        id: newId(),
        task_id: i.taskId,
        event: i.event,
        timestamp: isoNow(),
        payload: {
          task_id: i.taskId,
          ...(i.payload ?? {}),
        },
      };
      append(ev);
      const url = i.notifyUrl?.trim();
      if (url) {
        if (!/^https?:\/\//i.test(url)) {
          log(`notify_url must be http(s); skipped (${url})`);
        } else {
          const p = postWebhook(url, ev);
          pendingHooks.push(p);
          void p.finally(() => {
            const idx = pendingHooks.indexOf(p);
            if (idx >= 0) pendingHooks.splice(idx, 1);
          });
        }
      }
      return ev;
    },

    list(taskId) {
      return [...(byTask.get(taskId) ?? [])];
    },

    listSince(taskIds, afterId = null) {
      return collectSince(
        taskIds.map((t) => String(t)),
        afterId,
      );
    },

    wait(taskId, timeoutMs, afterId = null) {
      const existing = collectSince([taskId], afterId);
      if (existing.length) return Promise.resolve(existing[0]!);

      const ms = Math.max(0, Math.min(timeoutMs, 120_000));
      return new Promise<TaskNotifyEvent | null>((resolve) => {
        const timer = setTimeout(() => {
          const idx = waiters.findIndex((w) => w.timer === timer);
          if (idx >= 0) waiters.splice(idx, 1);
          resolve(null);
        }, ms);
        waiters.push({
          taskId,
          taskIds: null,
          afterId,
          resolve,
          timer,
        });
      });
    },

    waitAny(taskIds, timeoutMs, afterId = null) {
      if (taskIds.length === 0) return Promise.resolve(null);
      const existing = collectSince(
        taskIds.map((t) => String(t)),
        afterId,
      );
      if (existing.length) return Promise.resolve(existing[0]!);

      const ms = Math.max(0, Math.min(timeoutMs, 120_000));
      const set = new Set(taskIds.map((t) => String(t)));
      return new Promise<TaskNotifyEvent | null>((resolve) => {
        const timer = setTimeout(() => {
          const idx = waiters.findIndex((w) => w.timer === timer);
          if (idx >= 0) waiters.splice(idx, 1);
          resolve(null);
        }, ms);
        waiters.push({
          taskId: null,
          taskIds: set,
          afterId,
          resolve,
          timer,
        });
      });
    },

    async flush() {
      await Promise.allSettled([...pendingHooks]);
    },
  };
}
