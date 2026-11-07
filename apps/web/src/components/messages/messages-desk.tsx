"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  EscrowStatus,
  type EscrowTask,
  type TaskId,
  type ThreadMessage,
} from "@proofwork/shared/browser";
import { ChatPane } from "@/components/messages/chat-pane";
import { ConversationList } from "@/components/messages/conversation-list";
import { GigSidebar } from "@/components/messages/gig-sidebar";
import { ThreadHeaderTimers } from "@/components/task/thread-header-timers";
import { EmptyState } from "@/components/ui/empty-state";
import { callMcpTool } from "@/lib/adapters/mcp-client";
import { useAppState } from "@/lib/adapters/use-app-state";
import { useLiveTask } from "@/lib/adapters/use-live-task";
import {
  isUnread,
  lastVisibleMessage,
  type ConversationRow,
} from "@/lib/message-preview";
import {
  taskBelongsToWorker,
  useWorkerIdentity,
} from "@/lib/worker-identity";

type Role = "worker" | "owner";

type Props = {
  role: Role;
  taskId?: string;
  /** Base path for conversation links (no trailing slash). */
  basePath: string;
};

function messageable(task: EscrowTask): boolean {
  return (
    task.status === EscrowStatus.Accepted ||
    task.status === EscrowStatus.Submitted ||
    task.status === EscrowStatus.Paid ||
    task.status === EscrowStatus.Disputed ||
    task.status === EscrowStatus.ExpiredSla
  );
}

export function MessagesDesk({ role, taskId, basePath }: Props) {
  const state = useAppState();
  const identity = useWorkerIdentity();
  const router = useRouter();
  const [previews, setPreviews] = useState<
    Record<string, ThreadMessage | null>
  >({});
  const [tick, setTick] = useState(0);

  const tasks = useMemo(() => {
    const all = Object.values(state.tasks).filter(messageable);
    if (role === "worker") {
      if (!identity.address && !identity.nullifier) return [];
      return all
        .filter((t) => taskBelongsToWorker(t, identity))
        .sort((a, b) => b.createdAt - a.createdAt);
    }
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }, [state.tasks, role, identity]);

  useEffect(() => {
    let cancelled = false;
    const loadPreviews = async () => {
      const next: Record<string, ThreadMessage | null> = {};
      await Promise.all(
        tasks.slice(0, 40).map(async (t) => {
          try {
            const rows = await callMcpTool<ThreadMessage[]>("list_messages", {
              taskId: t.id,
            });
            next[t.id] = lastVisibleMessage(rows ?? []);
          } catch {
            next[t.id] = null;
          }
        }),
      );
      if (!cancelled) setPreviews(next);
    };
    void loadPreviews();
    const id = window.setInterval(() => {
      if (!cancelled) void loadPreviews();
    }, 2_500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [tasks, tick]);

  const selectedId = (taskId as TaskId | undefined) ?? null;
  const selectedFromStore = selectedId ? state.tasks[selectedId] : null;
  const selected = useLiveTask(selectedId, selectedFromStore);

  const rows: ConversationRow[] = useMemo(
    () =>
      tasks.map((task) => {
        const rowTask =
          selectedId && selected && task.id === selectedId ? selected : task;
        const last = previews[task.id] ?? null;
        return {
          task: rowTask,
          last,
          unread: isUnread(task.id, last),
        };
      }),
    [tasks, previews, selectedId, selected],
  );

  useEffect(() => {
    if (taskId || tasks.length === 0) return;
    const firstUnread = rows.find((r) => r.unread)?.task.id ?? tasks[0]?.id;
    if (firstUnread) {
      router.replace(`${basePath}/${firstUnread}`);
    }
  }, [taskId, tasks, rows, basePath, router]);

  const asRole = role === "worker" ? "worker" : "agent";

  return (
    <div className="pw-msg-desk">
      <aside className="pw-msg-list" aria-label="Conversations">
        <div className="pw-msg-list__head">
          <p className="text-[13px] font-semibold tracking-tight">Messages</p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {rows.length}
          </p>
        </div>
        <ConversationList
          rows={rows}
          selectedId={selectedId}
          hrefFor={(t) => `${basePath}/${t.id}`}
          emptyHint={
            role === "worker"
              ? identity.ready && !identity.address && !identity.nullifier
                ? "Sign in with World to see your claimed gigs."
                : "Claim a gig to start a thread."
              : "Waiting on worker submissions."
          }
        />
      </aside>

      {selected && messageable(selected) ? (
        <>
          <section className="pw-msg-chat" aria-label="Conversation">
            <header className="pw-msg-chat__head">
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold tracking-tight">
                  {selected.title?.trim() ||
                    selected.posterAgent ||
                    "Task thread"}
                </p>
                <p className="truncate font-mono text-[10px] text-muted-foreground">
                  {selected.id}
                </p>
                <ThreadHeaderTimers task={selected} />
              </div>
            </header>
            <ChatPane
              task={selected}
              asRole={asRole}
              refreshKey={tick}
              onPosted={() => setTick((n) => n + 1)}
              className="min-h-0 flex-1"
            />
          </section>
          <GigSidebar
            task={selected}
            role={role}
            onChanged={() => setTick((n) => n + 1)}
          />
        </>
      ) : (
        <div className="pw-msg-chat flex items-center justify-center p-8">
          <EmptyState
            title={rows.length ? "Select a conversation" : "No threads"}
            body={
              role === "worker"
                ? "Open a claimed gig to chat with the posting agent."
                : "Review inbox fills as workers submit evidence."
            }
          />
        </div>
      )}
    </div>
  );
}
