"use client";

import { useMemo } from "react";
import Link from "next/link";
import { EscrowStatus } from "@proofwork/shared/browser";
import { useAppState } from "@/lib/adapters/use-app-state";
import { formatHbar } from "@/lib/format";
import { getTaskMeta } from "@/lib/task-catalog";
import { buttonVariants } from "@/components/ui/button-variants";
import { DataTable, Table } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import {
  GigRowCountdown,
  TimerBadges,
} from "@/components/task/timer-badges";
import { cn } from "@/lib/utils";

export function ReviewInbox() {
  const state = useAppState();

  const inbox = useMemo(() => {
    return Object.values(state.tasks)
      .filter(
        (t) =>
          t.status === EscrowStatus.Submitted ||
          t.status === EscrowStatus.Disputed ||
          t.status === EscrowStatus.Paid ||
          t.status === EscrowStatus.ExpiredSla,
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [state.tasks]);

  return (
    <section className="space-y-2">
      <div className="flex items-end justify-between gap-3 px-0.5">
        <h2 className="pw-section-title">Review inbox</h2>
        <Link
          href="/owner/messages"
          className="text-[12px] text-muted-foreground underline"
        >
          Open messages
        </Link>
      </div>
      {inbox.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          body="After a worker submits evidence, the thread shows up here. You (or your agent) call all_satisfied to pay — nothing auto-pays."
        />
      ) : (
        <DataTable
          ariaLabel="Review inbox"
          columns={[
            { key: "gig", label: "Gig", isRowHeader: true },
            { key: "time", label: "Time left" },
            { key: "status", label: "Status" },
            { key: "place", label: "Place" },
            { key: "reward", label: "Reward", align: "right" },
            { key: "act", label: "" },
          ]}
        >
          {inbox.map((t) => {
            const m = getTaskMeta(t);
            return (
              <Table.Row key={t.id} id={t.id}>
                <Table.Cell>
                  <p className="font-medium">{m.title}</p>
                  <div className="mt-1 hidden sm:block">
                    <TimerBadges task={t} />
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <GigRowCountdown task={t} />
                </Table.Cell>
                <Table.Cell>
                  <StatusPill status={t.status} />
                </Table.Cell>
                <Table.Cell className="text-[12px] text-muted-foreground">
                  {m.place}
                </Table.Cell>
                <Table.Cell className="text-right font-mono tabular-nums">
                  {formatHbar(t.rewardWei)}
                </Table.Cell>
                <Table.Cell className="text-right">
                  <Link
                    href={`/owner/messages/${t.id}`}
                    className={cn(
                      buttonVariants({ size: "sm", variant: "secondary" }),
                    )}
                  >
                    Review
                  </Link>
                </Table.Cell>
              </Table.Row>
            );
          })}
        </DataTable>
      )}
    </section>
  );
}
