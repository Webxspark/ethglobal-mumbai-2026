"use client";

import Link from "next/link";
import type { EscrowTask } from "@proofwork/shared/browser";
import { GigRowCountdown } from "@/components/task/timer-badges";
import { StatusPill } from "@/components/ui/status-pill";
import {
  formatMsgTime,
  previewBody,
  type ConversationRow,
} from "@/lib/message-preview";
import { formatHbar } from "@/lib/format";
import { getTaskMeta } from "@/lib/task-catalog";
import { cn } from "@/lib/utils";

type Props = {
  rows: ConversationRow[];
  selectedId: string | null;
  hrefFor: (task: EscrowTask) => string;
  emptyHint?: string;
};

export function ConversationList({
  rows,
  selectedId,
  hrefFor,
  emptyHint = "No conversations yet.",
}: Props) {
  if (rows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-[13px] font-medium">Inbox empty</p>
        <p className="text-[12px] text-muted-foreground">{emptyHint}</p>
      </div>
    );
  }

  return (
    <ul className="pw-msg-list__ul" role="list">
      {rows.map(({ task, last, unread }) => {
        const meta = getTaskMeta(task);
        const title = task.title?.trim() || meta.title;
        const active = selectedId === task.id;
        return (
          <li key={task.id}>
            <Link
              href={hrefFor(task)}
              className={cn(
                "pw-msg-list__item",
                active && "pw-msg-list__item--active",
              )}
              aria-current={active ? "page" : undefined}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate text-[13px] font-medium">
                    {unread ? (
                      <span
                        className="inline-block size-1.5 shrink-0 rounded-full bg-[#111]"
                        aria-label="Unread"
                      />
                    ) : null}
                    <span className="truncate">{title}</span>
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                    {previewBody(last)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {last ? formatMsgTime(last.createdAt) : ""}
                  </p>
                  <p className="mt-1 font-mono text-[10px] tabular-nums">
                    {formatHbar(task.rewardWei)}
                  </p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusPill status={task.status} />
                <GigRowCountdown task={task} />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
