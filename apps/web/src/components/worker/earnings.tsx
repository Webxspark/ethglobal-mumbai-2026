"use client";

import { useMemo } from "react";
import { EscrowStatus } from "@proofwork/shared/browser";
import { useAppState } from "@/lib/adapters/use-app-state";
import { formatHbar, relativeTime, shortAddr } from "@/lib/format";
import { getTaskMeta } from "@/lib/task-catalog";

type PaidRow = {
  id: string;
  title: string;
  amountWei: bigint;
  at: number;
  txHash?: string | null;
  explorer?: string | null;
  to?: string | null;
};

export function WorkerEarnings() {
  const state = useAppState();

  const rows = useMemo(() => {
    const out: PaidRow[] = [];
    for (const t of Object.values(state.tasks)) {
      if (t.status !== EscrowStatus.Paid) continue;
      const meta = getTaskMeta(t);
      const explorer =
        t.payoutExplorerUrl ??
        (t.payoutTxHash
          ? `https://hashscan.io/testnet/transaction/${t.payoutTxHash}`
          : null);
      out.push({
        id: t.id,
        title: meta?.title ?? shortAddr(t.id),
        amountWei: t.rewardWei,
        at: t.createdAt,
        txHash: t.payoutTxHash,
        explorer,
        to: t.payoutAddress,
      });
    }
    // Newest first — Paid tasks don't have paidAt; sort by id as weak proxy.
    return out.reverse();
  }, [state.tasks]);

  return (
    <section className="space-y-2">
      <div className="flex items-end justify-between gap-3 px-0.5">
        <h2 className="pw-section-title">Earnings</h2>
        <span className="font-mono text-[10px] text-muted-foreground">
          on-chain
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="pw-empty">
          <p className="text-[13px] font-medium">No payouts yet</p>
          <p className="text-[12px] text-muted-foreground">
            After all_satisfied, paid gigs and HashScan links show up here.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="pw-row-card">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="truncate text-[13px] font-medium">{r.title}</p>
                <p className="font-mono text-[10px] text-muted-foreground">
                  {relativeTime(
                    r.at > 1e12 ? Math.floor(r.at / 1000) : r.at,
                    Math.floor(Date.now() / 1000),
                  )}
                  {r.to ? ` · ${shortAddr(r.to)}` : ""}
                </p>
                {r.explorer ? (
                  <a
                    href={r.explorer}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[12px] underline"
                  >
                    HashScan
                    {r.txHash ? ` · ${r.txHash.slice(0, 10)}…` : ""}
                  </a>
                ) : (
                  <p className="text-[12px] text-muted-foreground">
                    Ledger paid — awaiting on-chain tx
                  </p>
                )}
              </div>
              <p className="pw-amount pw-amount--in">
                +{formatHbar(r.amountWei)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
