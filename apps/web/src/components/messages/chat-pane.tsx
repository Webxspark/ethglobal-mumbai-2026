"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type DragEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type UIEvent,
} from "react";
import { Avatar, ScrollShadow, TextArea } from "@heroui/react";
import { Paperclip, Send, X } from "lucide-react";
import type {
  EscrowTask,
  ThreadAttachment,
  ThreadMessage,
  ThreadRole,
} from "@proofwork/shared/browser";
import { Button } from "@/components/ui/button";
import { MessageMarkdown } from "@/components/messages/message-markdown";
import { callMcpTool, mcpBaseUrl } from "@/lib/adapters/mcp-client";
import {
  dayKey,
  dayLabel,
  filterThreadMessages,
  formatBytes,
  formatMsgTime,
  markRead,
} from "@/lib/message-preview";
import { cn } from "@/lib/utils";

const THREAD_POLL_MS = 2_500;

type PendingFile = {
  name: string;
  dataUrl: string;
  size: number;
  type: string;
};

type Props = {
  task: EscrowTask;
  asRole: "worker" | "owner" | "agent";
  refreshKey?: number;
  onPosted?: () => void;
  className?: string;
};

function attachmentHref(a: ThreadAttachment): string {
  return `${mcpBaseUrl()}/attachments/${encodeURIComponent(a.id)}`;
}

function isImage(a: { contentType?: string; filename: string }): boolean {
  if (a.contentType?.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|heic)$/i.test(a.filename);
}

function AttachmentThumb({ a }: { a: ThreadAttachment }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void callMcpTool<{
      contentType?: string;
      dataBase64?: string;
    }>("get_attachment", {
      attachmentId: a.id,
      include_data: true,
    })
      .then((hit) => {
        if (cancelled || !hit.dataBase64) return;
        const mime = hit.contentType || a.contentType || "application/octet-stream";
        setSrc(`data:${mime};base64,${hit.dataBase64}`);
      })
      .catch(() => {
        if (!cancelled) setSrc(attachmentHref(a));
      });
    return () => {
      cancelled = true;
    };
  }, [a.id, a.contentType]);
  if (!src) {
    return (
      <div className="pw-chat__thumb pw-chat__thumb--loading" aria-hidden />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={a.filename} className="pw-chat__thumb" />;
}

function initialsFor(role: ThreadRole): string {
  if (role === "worker") return "W";
  if (role === "owner") return "O";
  if (role === "agent") return "P";
  return "·";
}

function roleLabel(role: ThreadRole, asRole: Props["asRole"]): string {
  if (role === "worker") return asRole === "worker" ? "You" : "Worker";
  if (role === "agent") return "Posting";
  if (role === "owner") return "Owner";
  return role;
}

function mineSide(role: ThreadRole, asRole: Props["asRole"]): boolean {
  if (asRole === "worker") return role === "worker";
  return role === "agent" || role === "owner";
}

export function ChatPane({
  task,
  asRole,
  refreshKey = 0,
  onPosted,
  className,
}: Props) {
  const [msgs, setMsgs] = useState<ThreadMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [newBelow, setNewBelow] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const prevLenRef = useRef(0);

  const loadThread = useCallback(
    async (opts?: { silent?: boolean }) => {
      try {
        const rows = await callMcpTool<ThreadMessage[]>("list_messages", {
          taskId: task.id,
        });
        const visible = filterThreadMessages(rows ?? []);
        const grew = visible.length > prevLenRef.current;
        prevLenRef.current = visible.length;
        setMsgs(visible);
        const last = visible[visible.length - 1];
        if (last) markRead(task.id, last.createdAt);
        if (grew && !atBottomRef.current && !opts?.silent) {
          setNewBelow(true);
        } else if (atBottomRef.current) {
          setNewBelow(false);
          bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
        }
      } catch (e) {
        if (!opts?.silent) {
          setErr(e instanceof Error ? e.message : "thread load failed");
        }
      }
    },
    [task.id],
  );

  useEffect(() => {
    let cancelled = false;
    startTransition(async () => {
      if (cancelled) return;
      await loadThread();
    });
    return () => {
      cancelled = true;
    };
  }, [task.id, task.status, refreshKey, loadThread]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void loadThread({ silent: true });
    }, THREAD_POLL_MS);
    return () => window.clearInterval(id);
  }, [loadThread]);

  useEffect(() => {
    if (atBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [msgs.length, pending]);

  function onScroll(ev: UIEvent<HTMLDivElement>) {
    const el = ev.currentTarget;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottomRef.current = dist < 72;
    if (atBottomRef.current) setNewBelow(false);
  }

  function scrollToLatest() {
    atBottomRef.current = true;
    setNewBelow(false);
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  const ingestFiles = useCallback((list: FileList | File[]) => {
    const arr = Array.from(list).filter((f) => f.type.startsWith("image/"));
    if (!arr.length) {
      setErr("Images only for attachments");
      return;
    }
    setErr(null);
    for (const file of arr) {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== "string") return;
        setFiles((prev) => [
          ...prev,
          {
            name: file.name || "image.jpg",
            dataUrl: reader.result as string,
            size: file.size,
            type: file.type,
          },
        ]);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  function onPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.files;
    if (items && items.length) {
      e.preventDefault();
      ingestFiles(items);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) ingestFiles(e.dataTransfer.files);
  }

  function send() {
    const body = draft.trim();
    if (!body && files.length === 0) return;
    setErr(null);
    startTransition(async () => {
      try {
        const attachments = files.length
          ? files.map((f) => ({
              filename: f.name,
              contentType: f.type || "image/jpeg",
              data: f.dataUrl,
            }))
          : undefined;
        const res = await callMcpTool<{ message: ThreadMessage }>(
          "send_message",
          {
            taskId: task.id,
            role: asRole,
            body: body || undefined,
            kind: files.length ? "evidence" : "chat",
            attachments,
          },
        );
        atBottomRef.current = true;
        setMsgs((m) => filterThreadMessages([...m, res.message]));
        markRead(task.id, res.message.createdAt);
        setDraft("");
        setFiles([]);
        if (fileRef.current) fileRef.current.value = "";
        onPosted?.();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "send failed");
      }
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const rows: Array<
    | { type: "day"; key: string; label: string }
    | { type: "msg"; key: string; msg: ThreadMessage }
  > = [];
  let prevDay: string | null = null;
  for (const m of msgs) {
    const dk = dayKey(m.createdAt);
    if (dk !== prevDay) {
      rows.push({ type: "day", key: `d-${dk}`, label: dayLabel(m.createdAt) });
      prevDay = dk;
    }
    rows.push({ type: "msg", key: m.id, msg: m });
  }

  return (
    <div
      className={cn("pw-chat", className)}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      data-drag={dragOver ? "1" : undefined}
    >
      <div className="relative min-h-0 flex-1">
        <ScrollShadow
          className="pw-chat__scroll"
          ref={scrollRef}
          onScroll={onScroll}
        >
          {msgs.length === 0 && !pending ? (
            <div className="pw-chat__empty">
              <p className="text-[14px] font-medium">No messages yet</p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Say hello, or attach evidence when you are ready.
              </p>
            </div>
          ) : (
            <div className="pw-chat__feed">
              {rows.map((row) => {
                if (row.type === "day") {
                  return (
                    <div key={row.key} className="pw-chat__day">
                      <span>{row.label}</span>
                    </div>
                  );
                }
                const m = row.msg;
                if (m.kind === "system") {
                  return (
                    <div key={m.id} className="pw-chat__system">
                      <span>{m.body}</span>
                      <time>{formatMsgTime(m.createdAt)}</time>
                    </div>
                  );
                }
                const mine = mineSide(m.role, asRole);
                return (
                  <div
                    key={m.id}
                    className={cn("pw-chat__row", mine && "pw-chat__row--mine")}
                  >
                    <Avatar className="size-8 shrink-0" size="sm">
                      <Avatar.Fallback className="bg-[#e8eaed] text-[11px] font-medium text-[#111]">
                        {initialsFor(m.role)}
                      </Avatar.Fallback>
                    </Avatar>
                    <div
                      className={cn(
                        "pw-chat__bubble",
                        mine && "pw-chat__bubble--mine",
                      )}
                    >
                      <div className="pw-chat__meta">
                        <span>{roleLabel(m.role, asRole)}</span>
                        <time>{formatMsgTime(m.createdAt)}</time>
                      </div>
                      {m.kind === "form_response" && m.formCard?.length ? (
                        <dl className="pw-form-card space-y-1.5">
                          {m.formCard.map((row) => {
                            let display = "";
                            const val = row.value;
                            let att: ThreadAttachment | undefined;
                            if (
                              val &&
                              typeof val === "object" &&
                              !Array.isArray(val)
                            ) {
                              if ("attachmentId" in val) {
                                const attId = val.attachmentId as string;
                                display = val.filename || attId;
                                att = m.attachments?.find((a) => a.id === attId);
                              } else if ("lat" in val) {
                                display = `${val.lat.toFixed(5)}, ${val.lng.toFixed(5)}`;
                              } else {
                                display = JSON.stringify(val);
                              }
                            } else if (Array.isArray(val)) {
                              display = val.join(", ");
                            } else if (typeof val === "boolean") {
                              display = val ? "yes" : "no";
                            } else {
                              display = String(val);
                            }
                            return (
                              <div key={row.id} className="flex flex-col gap-0.5">
                                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                  {row.label}
                                </dt>
                                <dd className="text-[12px]">
                                  {att && isImage(att) ? (
                                    <AttachmentThumb a={att} />
                                  ) : null}
                                  <span className="inline-block align-top">
                                    {display}
                                  </span>
                                </dd>
                              </div>
                            );
                          })}
                        </dl>
                      ) : m.body ? (
                        <MessageMarkdown body={m.body} className="pw-chat__body" />
                      ) : null}
                      {m.kind !== "form_response"
                        ? m.attachments?.map((a) => {
                            const href = attachmentHref(a);
                            const img = isImage(a);
                            return (
                              <div key={a.id} className="pw-chat__attach">
                                {img ? <AttachmentThumb a={a} /> : null}
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-[12px] font-medium">
                                    {a.filename}
                                  </p>
                                  <p className="font-mono text-[10px] text-muted-foreground">
                                    {formatBytes(a.size)} · {a.id}
                                  </p>
                                </div>
                                <a
                                  href={href}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[11px] underline"
                                >
                                  Open
                                </a>
                              </div>
                            );
                          })
                        : null}
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
          )}
        </ScrollShadow>
        {newBelow ? (
          <button
            type="button"
            className="pw-chat__new"
            onClick={scrollToLatest}
          >
            New messages
          </button>
        ) : null}
      </div>

      {err ? (
        <p className="px-4 py-1 text-[12px] text-[#b42318]" role="alert">
          {err}
        </p>
      ) : null}

      {files.length ? (
        <div className="pw-chat__chips">
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="pw-chat__chip">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.dataUrl} alt="" className="size-8 rounded object-cover" />
              <span className="max-w-[8rem] truncate text-[11px]">{f.name}</span>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                className="size-6 min-w-6"
                aria-label="Remove attachment"
                onPress={() =>
                  setFiles((prev) => prev.filter((_, j) => j !== i))
                }
              >
                <X className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="pw-chat__composer">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            if (e.target.files) ingestFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          className="size-9 shrink-0"
          aria-label="Attach image"
          isDisabled={pending}
          onPress={() => fileRef.current?.click()}
        >
          <Paperclip className="size-4" />
        </Button>
        <TextArea
          fullWidth
          variant="secondary"
          className="min-h-[40px] flex-1"
          placeholder={
            asRole === "worker"
              ? "Message the posting agent…"
              : "Reply in thread…"
          }
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          aria-label="Thread message"
          rows={1}
        />
        <Button
          isIconOnly
          size="sm"
          className="size-9 shrink-0"
          aria-label={pending ? "Sending" : "Send"}
          isDisabled={pending || (!draft.trim() && files.length === 0)}
          onPress={send}
        >
          <Send className="size-4" />
        </Button>
      </div>
      {pending ? (
        <p className="px-4 pb-2 text-[11px] text-muted-foreground" role="status">
          Sending…
        </p>
      ) : null}
    </div>
  );
}
