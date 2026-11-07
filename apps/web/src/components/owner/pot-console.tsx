"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, useTransition } from "react";
import { EscrowStatus, type Wei } from "@proofwork/shared/browser";
import { setAgentPassThreshold } from "@/lib/adapters/ports";
import { useAppState } from "@/lib/adapters/use-app-state";
import { approveLivePending } from "@/lib/adapters/live-store";
import { ConnectBanner } from "@/components/shell/connect-banner";
import { ConnectAgentPanel } from "@/components/owner/connect-agent";
import { ReviewInbox } from "@/components/owner/review-inbox";

const FundPotSheet = dynamic(
  () =>
    import("@/components/owner/fund-pot-sheet").then((m) => m.FundPotSheet),
  { ssr: false },
);
import { AGENT_TOOLS } from "@/lib/agent-tools";
import { WEI_PER_UNIT } from "@/lib/constants";
import { formatHbar, parseHbarToWei, relativeTime, shortAddr } from "@/lib/format";
import { requireSessionPot } from "@/lib/session-pot";
import { useSession } from "@/lib/use-session";
import { Label, NumberField } from "@heroui/react";
import { pauseLivePolling } from "@/lib/adapters/live-poll";
import { AppModal } from "@/components/ui/app-modal";
import { Button } from "@/components/ui/button";
import { DataTable, Table } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Toast, notify } from "@/components/ui/toast";
import { WorldMark } from "@/components/ui/world-mark";
import {
  fetchHonestyStatus,
  PROOFWORK_LIVE_ORIGIN,
  type HonestyStatus,
} from "@/lib/honesty";

type SheetKind = null | "fund" | "threshold" | "agent-pass";

export type OwnerSection =
  | "overview"
  | "pot"
  | "gigs"
  | "agents"
  | "activity"
  | "all";

export function PotConsole({ section = "all" }: { section?: OwnerSection }) {
  const state = useAppState();
  const { session } = useSession();
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [thresholdAmount, setThresholdAmount] = useState(1);
  const [passPhase, setPassPhase] = useState<
    "idle" | "scanning" | "confirmed" | "error"
  >("idle");
  const [pendingApprovalId, setPendingApprovalId] = useState<string | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [honesty, setHonesty] = useState<HonestyStatus | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!sheet) return;
    return pauseLivePolling();
  }, [sheet]);

  useEffect(() => {
    let cancelled = false;
    fetchHonestyStatus()
      .then((s) => {
        if (!cancelled) setHonesty(s);
      })
      .catch(() => {
        /* banner stays quiet if status API down */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pendingApprovals = useMemo(
    () => state.approvals.filter((a) => a.status === "pending"),
    [state.approvals],
  );

  const available = state.pot.balanceWei;
  const spent = state.pot.spentWei;
  const threshold = state.pot.agentPassThresholdWei;
  const audit = state.audit.slice(0, 12);

  const taskList = useMemo(() => Object.values(state.tasks), [state.tasks]);
  const openGigs = useMemo(
    () => taskList.filter((t) => t.status === EscrowStatus.Open).length,
    [taskList],
  );
  const lockedWei = useMemo(() => {
    return taskList
      .filter(
        (t) =>
          t.status === EscrowStatus.Accepted ||
          t.status === EscrowStatus.Submitted ||
          t.status === EscrowStatus.Verified ||
          t.status === EscrowStatus.Open,
      )
      .reduce((sum, t) => sum + t.rewardWei, 0n);
  }, [taskList]);
  const paidWei = useMemo(() => {
    return taskList
      .filter((t) => t.status === EscrowStatus.Paid)
      .reduce((sum, t) => sum + t.rewardWei, 0n);
  }, [taskList]);

  function openAgentPass(approvalId: string) {
    setPendingApprovalId(approvalId);
    setPassPhase("idle");
    setError(null);
    setSheet("agent-pass");
  }

  function runThreshold() {
    setError(null);
    startTransition(async () => {
      try {
        const wei = parseHbarToWei(String(thresholdAmount));
        await setAgentPassThreshold(wei);
        const msg = `Agent Pass threshold set to ${formatHbar(wei)}`;
        setMessage(msg);
        notify(msg);
        setSheet(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Invalid threshold");
      }
    });
  }

  /** Open Continuity via /api/world/approve/start. */
  function runLiveAgentPass() {
    if (!pendingApprovalId) return;
    const approval = state.approvals.find((a) => a.id === pendingApprovalId);
    if (!approval) return;
    setPassPhase("scanning");
    setError(null);
    startTransition(async () => {
      try {
        const credit = requireSessionPot(session);
        if (honesty && !honesty.world.agentPassReady) {
          const miss =
            honesty.world.missing.length > 0
              ? honesty.world.missing.join(", ")
              : "WORLD Agent Pass + IDKit keys";
          throw new Error(
            `Agent Pass not live (${miss}). Use ${PROOFWORK_LIVE_ORIGIN} if Continuity rejects localhost.`,
          );
        }
        const res = await fetch("/api/world/approve/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            taskId: approval.taskId,
            potId: credit.potId,
            amountWei: approval.amountWei.toString(),
            owner: credit.owner,
            reason: approval.reason,
            thresholdWei: threshold.toString(),
          }),
        });
        const body = (await res.json()) as {
          authorizeUrl?: string;
          required?: boolean;
          error?: string;
          message?: string;
        };
        if (!res.ok) {
          throw new Error(body.message ?? body.error ?? "approve/start failed");
        }
        if (body.required === false) {
          approveLivePending(approval.id);
          setPassPhase("confirmed");
          setMessage("Below threshold — no Agent Pass needed");
          return;
        }
        if (!body.authorizeUrl) {
          throw new Error("approve/start missing authorizeUrl");
        }
        window.location.assign(body.authorizeUrl);
      } catch (e) {
        setPassPhase("error");
        setError(e instanceof Error ? e.message : "Agent Pass failed");
      }
    });
  }

  const balanceBlock = (
    <section className="space-y-3">
      <div className="pw-metric-row">
        <div className="pw-metric">
          <p className="pw-metric__label">Pot balance</p>
          <p className="pw-metric__value" data-target="balance">
            {formatHbar(available)}
          </p>
        </div>
        <div className="pw-metric">
          <p className="pw-metric__label">Spent</p>
          <p className="pw-metric__value">{formatHbar(spent)}</p>
        </div>
        <div className="pw-metric">
          <p className="pw-metric__label">Agent Pass above</p>
          <p className="pw-metric__value">{formatHbar(threshold)}</p>
        </div>
        <div className="pw-metric">
          <p className="pw-metric__label">Network</p>
          <p className="pw-metric__value" style={{ fontSize: 14 }}>
            Hedera
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onPress={() => {
            setError(null);
            setSheet("fund");
          }}
        >
          Fund pot
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onPress={() => {
            setThresholdAmount(Number(threshold) / Number(WEI_PER_UNIT));
            setError(null);
            setSheet("threshold");
          }}
        >
          Set threshold
        </Button>
      </div>
    </section>
  );

  const approvalsBlock = (
    <section className="space-y-2">
      <div className="flex items-end justify-between gap-3 px-0.5">
        <h2 className="pw-section-title">Approvals</h2>
        <span className="font-mono text-[10px] text-muted-foreground">
          World Agent Pass
        </span>
      </div>
      {pendingApprovals.length === 0 ? (
        <EmptyState
          title="No pending approvals"
          body={
            <>
              Spend under {formatHbar(threshold)} encumbers without you. Over
              that, World Agent Pass lands here. Approvals appear when an
              over-threshold task is posted.
            </>
          }
        />
      ) : (
        <DataTable
          ariaLabel="Pending approvals"
          columns={[
            { key: "req", label: "Request", isRowHeader: true },
            { key: "reason", label: "Reason" },
            { key: "amt", label: "Amount", align: "right" },
            { key: "act", label: "" },
          ]}
        >
          {pendingApprovals.map((a) => (
            <Table.Row key={a.id} id={a.id}>
              <Table.Cell>
                <p className="font-medium">{a.title}</p>
                <p className="font-mono text-[10px] text-muted-foreground">
                  {relativeTime(a.createdAt)} · {shortAddr(a.taskId)}
                </p>
              </Table.Cell>
              <Table.Cell className="text-muted-foreground">
                {a.reason}
              </Table.Cell>
              <Table.Cell className="text-right font-mono tabular-nums">
                {formatHbar(a.amountWei)}
              </Table.Cell>
              <Table.Cell className="text-right">
                <Button size="sm" onPress={() => openAgentPass(a.id)}>
                  Approve
                </Button>
              </Table.Cell>
            </Table.Row>
          ))}
        </DataTable>
      )}
    </section>
  );

  const spendBlock = (
    <section className="space-y-2">
      <h2 className="pw-section-title px-0.5">Spend</h2>
      {state.spend.length === 0 ? (
        <EmptyState
          title="No spend yet"
          body="Fund the pot, or wait for an agent post / payout on the ledger."
        />
      ) : (
        <DataTable
          ariaLabel="Spend ledger"
          columns={[
            { key: "entry", label: "Entry", isRowHeader: true },
            { key: "kind", label: "Kind" },
            { key: "when", label: "When" },
            { key: "amt", label: "Amount", align: "right" },
          ]}
        >
          {state.spend.map((entry) => (
            <Table.Row key={entry.id} id={entry.id}>
              <Table.Cell className="font-medium">{entry.label}</Table.Cell>
              <Table.Cell className="font-mono text-[11px] text-muted-foreground">
                {entry.kind}
              </Table.Cell>
              <Table.Cell className="font-mono text-[11px] text-muted-foreground">
                {relativeTime(entry.at)}
              </Table.Cell>
              <Table.Cell className="text-right font-mono tabular-nums">
                {entry.kind === "fund" || entry.kind === "refund" ? "+" : "−"}
                {formatHbar(entry.amountWei)}
              </Table.Cell>
            </Table.Row>
          ))}
        </DataTable>
      )}
    </section>
  );

  const auditBlock = (
    <section className="space-y-2">
      <div className="flex items-end justify-between gap-3 px-0.5">
        <h2 className="pw-section-title">Audit trail</h2>
        <span className="font-mono text-[10px] text-muted-foreground">HCS</span>
      </div>
      {audit.length === 0 ? (
        <EmptyState
          title="No events yet"
          body="Fund, approve, and release actions append here."
        />
      ) : (
        <DataTable
          ariaLabel="Audit trail"
          columns={[
            { key: "event", label: "Event", isRowHeader: true },
            { key: "seq", label: "Sequence" },
            { key: "when", label: "When", align: "right" },
          ]}
        >
          {audit.map((e) => {
            const atSecs = e.at > 1e12 ? Math.floor(e.at / 1000) : e.at;
            return (
              <Table.Row
                key={`${e.type}-${e.sequenceNumber}`}
                id={`${e.type}-${e.sequenceNumber}`}
              >
                <Table.Cell className="font-mono text-[12px]">
                  {e.type}
                </Table.Cell>
                <Table.Cell className="font-mono text-[11px] text-muted-foreground">
                  seq {e.sequenceNumber}
                </Table.Cell>
                <Table.Cell className="text-right font-mono text-[11px] text-muted-foreground">
                  {relativeTime(atSecs)}
                </Table.Cell>
              </Table.Row>
            );
          })}
        </DataTable>
      )}
    </section>
  );

  const toolsBlock = (
    <section className="space-y-2">
      <div className="flex items-end justify-between gap-3 px-0.5">
        <h2 className="pw-section-title">Agent tools</h2>
        <span className="font-mono text-[10px] text-muted-foreground">MCP</span>
      </div>
      <div className="pw-tools">
        {AGENT_TOOLS.map((t) => (
          <div key={t.name} className="pw-tools__row">
            <span className="pw-tools__name">{t.name}</span>
            <span className="pw-tools__meta">{t.meta}</span>
          </div>
        ))}
      </div>
    </section>
  );

  const metaBlock = (
    <section className="pw-meta-panel">
      <p className="pw-kicker">Pot</p>
      <p className="mt-1 font-mono text-[11px] leading-5 break-all">
        {state.pot.id}
      </p>
      <p className="mt-1 font-mono text-[11px] text-muted-foreground">
        owner {shortAddr(state.pot.owner)}
      </p>
    </section>
  );

  return (
    <div className="space-y-5">
      <ConnectBanner />

      {message ? <Toast>{message}</Toast> : null}
      {error && !sheet ? <Toast tone="error">{error}</Toast> : null}

      {section === "overview" ? (
        <>
          <div className="pw-metric-row">
            <div className="pw-metric">
              <p className="pw-metric__label">Pot balance</p>
              <p className="pw-metric__value">{formatHbar(available)}</p>
            </div>
            <div className="pw-metric">
              <p className="pw-metric__label">Locked in escrow</p>
              <p className="pw-metric__value">
                {formatHbar(lockedWei as Wei)}
              </p>
            </div>
            <div className="pw-metric">
              <p className="pw-metric__label">Paid out</p>
              <p className="pw-metric__value">{formatHbar(paidWei as Wei)}</p>
            </div>
            <div className="pw-metric">
              <p className="pw-metric__label">Open gigs</p>
              <p className="pw-metric__value">{openGigs}</p>
            </div>
          </div>
          {approvalsBlock}
          <div className="grid gap-6 lg:grid-cols-2">
            {spendBlock}
            {auditBlock}
          </div>
        </>
      ) : null}

      {section === "pot" || section === "all" ? (
        <>
          {balanceBlock}
          {section === "pot" ? spendBlock : null}
          {metaBlock}
        </>
      ) : null}

      {section === "agents" || section === "all" ? (
        <>
          <ConnectAgentPanel />
          {toolsBlock}
        </>
      ) : null}

      {section === "gigs" || section === "all" ? (
        <>
          <ReviewInbox />
          {approvalsBlock}
        </>
      ) : null}

      {section === "activity" ? (
        <>
          {spendBlock}
          {auditBlock}
        </>
      ) : null}

      {section === "all" ? (
        <>
          {spendBlock}
          {auditBlock}
        </>
      ) : null}

      <FundPotSheet
        open={sheet === "fund"}
        onClose={() => setSheet(null)}
        onMessage={(msg) => {
          setMessage(msg);
          setError(null);
        }}
      />

      <AppModal
        open={sheet === "threshold"}
        onClose={() => setSheet(null)}
        title="Agent Pass threshold"
        footer={
          <>
            <Button variant="ghost" onPress={() => setSheet(null)}>
              Cancel
            </Button>
            <Button onPress={runThreshold}>Save threshold</Button>
          </>
        }
      >
        <p className="text-[13px] text-muted-foreground">
          Spend at or above this amount needs a fresh World Agent Pass before
          the task encumbers.
        </p>
        <NumberField
          className="w-full"
          fullWidth
          minValue={0}
          step={0.1}
          value={thresholdAmount}
          onChange={(n) =>
            setThresholdAmount(Number.isFinite(n) ? n : 0)
          }
          aria-label="Threshold HBAR"
        >
          <Label>Threshold</Label>
          <div className="flex items-center gap-2">
            <NumberField.Group className="min-w-0 flex-1">
              <NumberField.DecrementButton />
              <NumberField.Input className="w-full font-mono tabular-nums" />
              <NumberField.IncrementButton />
            </NumberField.Group>
            <span className="shrink-0 font-mono text-[12px] text-muted-foreground">
              HBAR
            </span>
          </div>
        </NumberField>
        {error ? (
          <p className="pw-error" role="alert">
            {error}
          </p>
        ) : null}
      </AppModal>

      <AppModal
        open={sheet === "agent-pass"}
        onClose={() => {
          if (passPhase === "scanning") return;
          setSheet(null);
          setPassPhase("idle");
        }}
        title="Agent Pass"
        footer={
          <>
            <Button
              variant="ghost"
              isDisabled={passPhase === "scanning"}
              onPress={() => {
                setSheet(null);
                setPassPhase("idle");
              }}
            >
              Cancel
            </Button>
            <Button
              isDisabled={
                pending || passPhase === "scanning" || passPhase === "confirmed"
              }
              onPress={runLiveAgentPass}
            >
              {passPhase === "scanning"
                ? "Verifying…"
                : passPhase === "confirmed"
                  ? "Done"
                  : "Authenticate with World"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <WorldMark size={44} />
          <p className="text-[13px] leading-5 text-muted-foreground">
            {passPhase === "idle" &&
              "Confirm over-threshold spend with World Continuity Agent Pass. Opens authorize URL."}
            {passPhase === "scanning" && "Starting Continuity…"}
            {passPhase === "confirmed" && "Approved. Task may encumber."}
            {passPhase === "error" && (error ?? "Verification failed")}
          </p>
          {pendingApprovalId ? (
            <p className="pw-amount text-center text-[15px]">
              {formatHbar(
                (state.approvals.find((a) => a.id === pendingApprovalId)
                  ?.amountWei ?? 0n) as Wei,
              )}
            </p>
          ) : null}
        </div>
      </AppModal>
    </div>
  );
}
