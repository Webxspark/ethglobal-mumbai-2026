import type { EscrowTask, ThreadMessage } from "@proofwork/shared/browser";
import { isTeemlAdvisoryMessage } from "@/lib/worker-identity";

const READ_KEY = "pw.msg.read.";

export function filterThreadMessages(msgs: ThreadMessage[]): ThreadMessage[] {
  return msgs.filter(
    (m) => !(m.kind === "system" && isTeemlAdvisoryMessage(m.body)),
  );
}

export function lastVisibleMessage(
  msgs: ThreadMessage[],
): ThreadMessage | null {
  const rows = filterThreadMessages(msgs);
  return rows.length ? rows[rows.length - 1]! : null;
}

export function previewBody(msg: ThreadMessage | null): string {
  if (!msg) return "No messages yet";
  if (msg.kind === "form_response") {
    const n = msg.formCard?.length ?? 0;
    return n ? `Form · ${n} answers` : "Form submitted";
  }
  if (msg.kind === "evidence") {
    const name = msg.attachments?.[0]?.filename;
    return name ? `Attachment · ${name}` : "Evidence submitted";
  }
  if (msg.kind === "system") return msg.body;
  const body = msg.body.trim();
  return body.length > 72 ? `${body.slice(0, 72)}…` : body || "Message";
}

export function formatMsgTime(secs: number, now = Date.now()): string {
  const d = new Date(secs * 1000);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const yesterday = new Date(start);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d >= start) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (d >= yesterday) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function dayKey(secs: number): string {
  const d = new Date(secs * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dayLabel(secs: number, now = Date.now()): string {
  const d = new Date(secs * 1000);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const yesterday = new Date(start);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d >= start) return "Today";
  if (d >= yesterday) return "Yesterday";
  return d.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function readCursor(taskId: string): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(READ_KEY + taskId);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

export function markRead(taskId: string, createdAt: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(READ_KEY + taskId, String(createdAt));
}

export function isUnread(
  taskId: string,
  last: ThreadMessage | null,
): boolean {
  if (!last) return false;
  return last.createdAt > readCursor(taskId);
}

export type ConversationRow = {
  task: EscrowTask;
  last: ThreadMessage | null;
  unread: boolean;
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
