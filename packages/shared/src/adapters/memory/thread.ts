import { randomBytes } from "node:crypto";
import type { ThreadPort } from "../../ports/index.js";
import type {
  Cid,
  TaskId,
  ThreadMessage,
  UnixSecs,
} from "../../types.js";

export type MemoryThread = ThreadPort & {
  /** Test helper — wipe all threads. */
  clear(): void;
};

export function createMemoryThread(
  clock: () => UnixSecs = () => Math.floor(Date.now() / 1000) as UnixSecs,
): MemoryThread {
  // taskId → messages in arrival order
  const byTask = new Map<string, ThreadMessage[]>();

  return {
    clear() {
      byTask.clear();
    },

    async post(i) {
      const id = `msg-${randomBytes(6).toString("hex")}`;
      const attachments = i.attachments?.length ? [...i.attachments] : undefined;
      const row: ThreadMessage = {
        id,
        taskId: i.taskId,
        role: i.role,
        body: i.body,
        attachmentCid: (i.attachmentCid ?? null) as Cid | null,
        attachments,
        kind:
          i.kind ??
          (i.attachmentCid || attachments?.length ? "evidence" : "chat"),
        formCard: i.formCard?.length ? [...i.formCard] : undefined,
        createdAt: clock(),
      };
      const prev = byTask.get(i.taskId) ?? [];
      prev.push(row);
      byTask.set(i.taskId, prev);
      return row;
    },

    async list(taskId: TaskId) {
      return [...(byTask.get(taskId) ?? [])];
    },
  };
}
