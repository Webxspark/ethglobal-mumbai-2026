"use client";

import { useEffect, useState } from "react";
import { EscrowStatus, type EscrowTask } from "@proofwork/shared/browser";
import { ports } from "@/lib/adapters/ports";
import { MUMBAI_PIN } from "@/lib/constants";
import {
  formatDistanceM,
  formatHbar,
  haversineM,
  statusLabel,
} from "@/lib/format";
import { getTaskMeta } from "@/lib/task-catalog";
import { ConnectBanner } from "@/components/shell/connect-banner";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

type Radius = 5000 | 15000 | 40000;
type NearbyRow = EscrowTask & { distanceM: number };

const FEED_POLL_MS = 8_000;

function formatNearbyError(message: string): string {
  return message.replace(/\.+\s*$/, "").trim();
}

/** Arkiv-backed nearby: MCP `list` with `near` queries live Rabdi TaskFeed. */
async function loadNearby(radiusM: number): Promise<NearbyRow[]> {
  const tasks = await ports.escrow.list({
    near: { lat: MUMBAI_PIN.lat, lng: MUMBAI_PIN.lng, radiusM },
    status: [EscrowStatus.Open, EscrowStatus.Paid],
  });
  const rows: NearbyRow[] = [];
  for (const t of tasks) {
    if (!t.geo) continue;
    rows.push({ ...t, distanceM: haversineM(MUMBAI_PIN, t.geo) });
  }
  rows.sort((a, b) => a.distanceM - b.distanceM);
  return rows;
}

export function NearbyFeed() {
  const [radius, setRadius] = useState<Radius>(15000);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<NearbyRow[]>([]);

  useEffect(() => {
    let ignore = false;

    async function refresh() {
      try {
        const next = await loadNearby(radius);
        if (!ignore) {
          setRows(next);
          setLoadErr(null);
        }
      } catch (e) {
        if (!ignore) {
          setLoadErr(e instanceof Error ? e.message : "nearby load failed");
          setRows([]);
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    setLoading(true);
    void refresh();
    const id = window.setInterval(() => void refresh(), FEED_POLL_MS);
    return () => {
      ignore = true;
      window.clearInterval(id);
    };
  }, [radius]);

  const openCount = rows.filter((t) => t.status === EscrowStatus.Open).length;

  return (
    <div className="space-y-4">
      <ConnectBanner />
      <section className="pw-map-panel">
        <div className="pw-map-grid" aria-hidden />
        <div className="pw-map-pin" style={{ left: "52%", top: "46%" }}>
          <span className="pw-map-pin__dot" />
          <span className="pw-map-pin__label">You</span>
        </div>
        {rows.slice(0, 5).map((t, i) => {
          const left = 28 + ((i * 17) % 48);
          const top = 24 + ((i * 23) % 52);
          return (
            <div
              key={t.id}
              className="pw-map-task"
              style={{ left: `${left}%`, top: `${top}%` }}
              title={getTaskMeta(t).title}
            />
          );
        })}
        <div className="pw-map-legend">
          <p className="pw-kicker">Arkiv projection</p>
          <p className="text-[13px] font-medium">
            {MUMBAI_PIN.lat.toFixed(3)}, {MUMBAI_PIN.lng.toFixed(3)}
          </p>
          <p className="text-[12px] text-muted-foreground">
            {openCount} open · {rows.length} in radius
          </p>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        {([5000, 15000, 40000] as const).map((r) => (
          <Button
            key={r}
            size="sm"
            variant={radius === r ? "default" : "secondary"}
            className="h-7 rounded-[4px] px-2.5 text-[11px]"
            onPress={() => setRadius(r)}
          >
            {r >= 1000 ? `${r / 1000} km` : `${r} m`}
          </Button>
        ))}
      </div>

      {loadErr ? (
        <p className="pw-error" role="status">
          Arkiv nearby failed — {formatNearbyError(loadErr)}.
        </p>
      ) : null}

      {loading && rows.length === 0 && !loadErr ? (
        <p className="text-[12px] text-muted-foreground" role="status">
          Loading live Arkiv feed…
        </p>
      ) : null}

      {!loadErr && !loading && rows.length === 0 ? (
        <div className="pw-empty">
          <p className="text-[13px] font-medium">Nothing in this radius</p>
          <p className="text-[12px] text-muted-foreground">
            Widen the chips, or wait for an agent post with geo. After escrow
            pays or disputes, Arkiv drops the pin so finished work disappears.
          </p>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <ul className="space-y-2">
          {rows.map((task) => {
            const m = getTaskMeta(task);
            return (
              <li key={task.id} className="pw-row-card">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate text-[13px] font-medium">{m.title}</p>
                  <p className="truncate text-[12px] text-muted-foreground">
                    {m.place} · {m.neighborhood}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Badge
                      variant={
                        task.status === EscrowStatus.Open
                          ? "default"
                          : "secondary"
                      }
                    >
                      {statusLabel(task.status)}
                    </Badge>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {formatDistanceM(task.distanceM)}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <p className="pw-amount">{formatHbar(task.rewardWei)}</p>
                  {task.status === EscrowStatus.Open ? (
                    <Link
                      href="/worker/tasks"
                      className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
                    >
                      Open
                    </Link>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
