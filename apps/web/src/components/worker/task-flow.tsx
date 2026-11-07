"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  EscrowStatus,
  type EscrowTask,
  type FormResponse,
  type TaskId,
} from "@proofwork/shared/browser";
import { workerFromNullifier } from "@proofwork/shared";
import { ports } from "@/lib/adapters/ports";
import { pauseLivePolling } from "@/lib/adapters/live-poll";
import { useAppState } from "@/lib/adapters/use-app-state";
import { MUMBAI_PIN, WEI_PER_UNIT } from "@/lib/constants";
import {
  formatDistanceM,
  formatHbar,
  haversineM,
  statusLabel,
} from "@/lib/format";
import { getTaskMeta } from "@/lib/task-catalog";
import {
  DEFAULT_GIG_FILTERS,
  filterGigBoard,
  gigFiltersToParams,
  parseGigFilters,
  type GigBoardFilters,
} from "@/lib/gig-filters";
import { ConnectBanner } from "@/components/shell/connect-banner";
import {
  GigRowCountdown,
  TimerBadges,
} from "@/components/task/timer-badges";
import { formatWorkWindowLabel } from "@proofwork/shared/browser";
import { AppModal } from "@/components/ui/app-modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, Table } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { WorldMark } from "@/components/ui/world-mark";
import { isPast } from "@/lib/countdown";
import { WorldIdKitGate } from "@/components/worker/world-idkit";
import { WorkerEarnings } from "@/components/worker/earnings";
import { WorkerStrip } from "@/components/worker/worker-strip";
import { GigFilters } from "@/components/worker/gig-filters";
import { SubmissionFormPanel } from "@/components/worker/submission-form";
import { callMcpTool } from "@/lib/adapters/mcp-client";
import { notify } from "@/components/ui/toast";
import { refreshLiveStore } from "@/lib/adapters/live-store";
import {
  taskBelongsToWorker,
  useWorkerIdentity,
} from "@/lib/worker-identity";

const PayoutProfile = dynamic(
  () =>
    import("@/components/worker/payout-profile").then((m) => m.PayoutProfile),
  { ssr: false },
);

type Step = null | "detail" | "idkit" | "capture";

export type WorkerView = "board" | "claims" | "messages";

export function TaskFlow({ view = "board" }: { view?: WorkerView }) {
  const state = useAppState();
  const identity = useWorkerIdentity();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<GigBoardFilters>(() =>
    parseGigFilters(searchParams),
  );
  const [selectedId, setSelectedId] = useState<TaskId | null>(null);
  const [step, setStep] = useState<Step>(null);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [idkitPhase, setIdkitPhase] = useState<
    "idle" | "scanning" | "ok" | "error"
  >("idle");
  const [idkitRetry, setIdkitRetry] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  /** Stable claim target id — never store a polled task object. */
  const claimTargetId = useRef<TaskId | null>(null);

  const photoReady = Boolean(photoName && photoDataUrl);
  const worldVerified = Boolean(identity.nullifier || state.workerNullifier);
  const workerAddr = identity.address;

  // Messages view is a full-page desk now.
  useEffect(() => {
    if (view === "messages") router.replace("/worker/messages");
  }, [view, router]);

  // Pause MCP board polling while any claim / evidence modal is open.
  useEffect(() => {
    if (!step) return;
    return pauseLivePolling();
  }, [step]);

  // Keep filter state in the URL so refresh / share restores the board.
  useEffect(() => {
    const qs = gigFiltersToParams(filters).toString();
    const next = qs ? `${pathname}?${qs}` : pathname;
    const cur = searchParams.toString()
      ? `${pathname}?${searchParams.toString()}`
      : pathname;
    if (next !== cur) router.replace(next, { scroll: false });
  }, [filters, pathname, router, searchParams]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const t of Object.values(state.tasks)) {
      if (t.category) set.add(t.category);
    }
    return [...set].sort();
  }, [state.tasks]);

  const boardTasks = useMemo(() => {
    let pool = Object.values(state.tasks);

    if (view === "claims" || view === "messages") {
      pool = pool.filter((t) => taskBelongsToWorker(t, identity));
    }

    const filtered = filterGigBoard(pool, filters, WEI_PER_UNIT);
    // mild distance nudge when sort is newest and no search — keeps nearby feel
    if (filters.sort === "newest" && !filters.q) {
      return [...filtered].sort((a, b) => {
        if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
        const da = a.geo ? haversineM(MUMBAI_PIN, a.geo) : 1e12;
        const db = b.geo ? haversineM(MUMBAI_PIN, b.geo) : 1e12;
        return da - db;
      });
    }
    return filtered;
  }, [state.tasks, filters, view, identity]);

  const selected = selectedId ? state.tasks[selectedId] : null;
  const meta = selected ? getTaskMeta(selected) : null;
  const stateRef = useRef(state);
  stateRef.current = state;

  function threadHref(taskId: TaskId) {
    return view === "claims"
      ? `/worker/claims/${taskId}`
      : `/worker/messages/${taskId}`;
  }

  function openTask(task: EscrowTask) {
    setSelectedId(task.id);
    claimTargetId.current = task.id;
    setError(null);
    setPhotoName(null);
    setPhotoDataUrl(null);
    setIdkitPhase("idle");

    if (task.status === EscrowStatus.Open || task.status === EscrowStatus.Expired)
      setStep("detail");
    else if (task.status === EscrowStatus.Accepted) setStep("capture");
    else router.push(threadHref(task.id));
  }

  function closeSheets() {
    if (idkitPhase === "scanning") return;
    setStep(null);
  }

  const finishClaim = useCallback(
    (task: EscrowTask, nullifierHash: string, proof: unknown) => {
      setIdkitPhase("scanning");
      setError(null);
      startTransition(async () => {
        try {
          const worker = workerFromNullifier(nullifierHash);
          await ports.escrow.accept({
            taskId: task.id,
            worker,
            humanNullifier: nullifierHash,
            proof,
            signal: worker,
          });
          await refreshLiveStore();
          setIdkitPhase("ok");
          notify("Verified human", "info");
          setTimeout(() => {
            setStep("capture");
            setIdkitPhase("idle");
            setSelectedId(task.id);
            claimTargetId.current = task.id;
          }, 400);
        } catch (e) {
          setIdkitPhase("error");
          setError(e instanceof Error ? e.message : "Claim failed");
          setStep("idkit");
        }
      });
    },
    [],
  );

  function startAccept(task?: EscrowTask) {
    const hit = task ?? selected;
    if (!hit) return;
    setSelectedId(hit.id);
    claimTargetId.current = hit.id;
    setIdkitPhase("idle");
    setError(null);
    const nf = identity.nullifier ?? state.workerNullifier;
    if (!nf) {
      setError("Sign in with World before claiming.");
      return;
    }
    setStep("idkit");
  }

  const finishLiveIdkit = useCallback(
    (i: { nullifierHash: string; proof: unknown }) => {
      const id = claimTargetId.current ?? selectedId;
      const hit = id ? stateRef.current.tasks[id] : null;
      if (!hit) return;
      finishClaim(hit, i.nullifierHash, i.proof);
    },
    [finishClaim, selectedId],
  );

  const onIdkitBlocked = useCallback((msg: string) => {
    setError(msg);
  }, []);

  const onIdkitCancel = useCallback(() => {
    setStep("detail");
  }, []);

  function onPickFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Pick an image (camera or gallery)");
      return;
    }
    setError(null);
    setPhotoName(file.name || "proof.jpg");
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setPhotoDataUrl(reader.result);
    };
    reader.readAsDataURL(file);
  }

  function runSubmit() {
    if (!selected || !photoReady) return;
    if (!photoDataUrl) {
      setError("Add a photo before submitting evidence");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        // Persist bytes on MCP (.data/attachments) — send_message returns att_ id
        // and marks SUBMITTED. Never invent synthetic bafy-proof CIDs.
        const hit = await callMcpTool<{
          attachments?: { id: string }[];
          task?: { status?: string };
        }>("send_message", {
          taskId: selected.id,
          role: "worker",
          body: "Evidence attached",
          kind: "evidence",
          attachments: [
            {
              filename: photoName || "proof.jpg",
              contentType: "image/jpeg",
              data: photoDataUrl,
            },
          ],
        });
        const attId = hit.attachments?.[0]?.id;
        if (!attId) {
          throw new Error("Evidence upload failed — no attachment id returned");
        }
        // If chat submit race skipped escrow.submit, finish with the real att_ id.
        if (hit.task?.status !== "SUBMITTED") {
          await ports.escrow.submit({
            taskId: selected.id,
            resultCid: attId as never,
          });
        }
        setStep(null);
        router.push(`/worker/claims/${selected.id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Submit failed");
      }
    });
  }

  async function runSubmitForm(formResponse: FormResponse) {
    if (!selected) return;
    setError(null);
    await ports.escrow.submit({
      taskId: selected.id,
      formResponse,
    });
    await refreshLiveStore();
    const id = selected.id;
    setStep(null);
    router.push(`/worker/claims/${id}`);
  }

  const kicker =
    view === "claims"
      ? "My claims"
      : view === "messages"
        ? "Messages"
        : "Live gig board";

  const emptyTitle =
    view === "claims"
      ? "No claims yet"
      : view === "messages"
        ? "No threads yet"
        : "No gigs match these filters";

  return (
    <div className="space-y-4">
      <ConnectBanner />
      {view === "board" ? (
        <>
          <WorkerStrip userId={identity.label} />
          <PayoutProfile />
          <WorkerEarnings />
        </>
      ) : null}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="pw-kicker">{kicker}</p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {boardTasks.length} shown
          </p>
        </div>
        {view === "board" || view === "claims" ? (
          <GigFilters
            value={filters}
            onChange={setFilters}
            categories={categories}
          />
        ) : null}
        <p className="text-[12px] leading-5 text-muted-foreground">
          {view === "messages"
            ? "Open a thread to chat. Attachments stay on the task."
            : "Claim starts the work timer. Evidence goes to the thread."}
        </p>
      </section>

      {boardTasks.length === 0 ? (
        <EmptyState
          title={emptyTitle}
          body={
            <>
              Agent{" "}
              <span className="font-mono text-[11px]">post_gig</span> with
              deadline_at + max_work_secs, or clear filters.
            </>
          }
          action={
            view !== "messages" ? (
              <Button
                size="sm"
                variant="ghost"
                onPress={() => setFilters({ ...DEFAULT_GIG_FILTERS })}
              >
                Reset filters
              </Button>
            ) : null
          }
        />
      ) : (
        <div data-testid="gig-board">
          <DataTable
            ariaLabel={kicker}
            columns={[
              { key: "gig", label: "Gig", isRowHeader: true },
              { key: "time", label: "Time left" },
              { key: "status", label: "Status" },
              { key: "place", label: "Place" },
              { key: "reward", label: "Reward", align: "right" },
              { key: "act", label: "" },
            ]}
          >
            {boardTasks.map((task) => {
              const m = getTaskMeta(task);
              const title = task.title || m.title;
              const dist = task.geo
                ? haversineM(MUMBAI_PIN, task.geo)
                : null;
              const blocked = Boolean(
                workerAddr &&
                  (task.blockedWorkers ?? []).some(
                    (w) => w.toLowerCase() === workerAddr.toLowerCase(),
                  ),
              );
              const expired = isPast(task.deadlineAt ?? task.expiresAt);
              return (
                <Table.Row
                  key={task.id}
                  id={task.id}
                  data-testid="task-card"
                  data-task-id={task.id}
                >
                  <Table.Cell>
                    <Button
                      variant="ghost"
                      className="h-auto justify-start px-0 py-0 text-left font-normal"
                      onPress={() => openTask(task)}
                    >
                      <span className="block font-medium text-foreground">
                        {title}
                      </span>
                    </Button>
                  </Table.Cell>
                  <Table.Cell>
                    <GigRowCountdown task={task} />
                  </Table.Cell>
                  <Table.Cell>
                    <StatusPill status={task.status} />
                  </Table.Cell>
                  <Table.Cell className="text-[12px] text-muted-foreground">
                    {m.place}
                    {dist != null ? ` · ${formatDistanceM(dist)}` : ""}
                    {task.category ? (
                      <span className="mt-0.5 block font-mono text-[10px]">
                        {task.category}
                      </span>
                    ) : null}
                  </Table.Cell>
                  <Table.Cell className="text-right font-mono tabular-nums">
                    {formatHbar(task.rewardWei)}
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    {task.status === EscrowStatus.Open ? (
                      <Button
                        size="sm"
                        disabled={pending || expired || blocked}
                        data-testid="claim-btn"
                        onPress={() => startAccept(task)}
                      >
                        {blocked
                          ? "Blocked"
                          : expired
                            ? "Expired"
                            : worldVerified
                              ? "Claim"
                              : "Claim"}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onPress={() => openTask(task)}
                      >
                        {view === "messages" ? "Open chat" : "Open"}
                      </Button>
                    )}
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </DataTable>
        </div>
      )}

      <AppModal
        open={step === "detail" && !!selected && !!meta}
        onClose={closeSheets}
        title={meta?.title ?? "Task"}
      >
        {selected && meta ? (
          <div className="space-y-3">
            <div>
              <p className="text-[12px] text-muted-foreground">
                {meta.place} · {meta.neighborhood}
              </p>
              <p className="mt-2 text-[13px] leading-5">{meta.instructions}</p>
              {selected.status === EscrowStatus.Open &&
              formatWorkWindowLabel(selected.maxWorkSecs) ? (
                <p className="mt-2 text-[12px] text-muted-foreground">
                  You&apos;ll have{" "}
                  {formatWorkWindowLabel(selected.maxWorkSecs)} to submit once
                  claimed.
                </p>
              ) : null}
            </div>
            <div className="pw-meta-panel">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[12px] text-muted-foreground">Bounty</span>
                <span className="pw-amount">{formatHbar(selected.rewardWei)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-[12px] text-muted-foreground">Status</span>
                <Badge variant="outline">{statusLabel(selected.status)}</Badge>
              </div>
              <div className="mt-2">
                <TimerBadges task={selected} />
              </div>
            </div>
            {selected.status === EscrowStatus.Open ? (
              isPast(selected.deadlineAt ?? selected.expiresAt) ? (
                <Button className="h-9 w-full text-[13px]" size="lg" disabled>
                  Expired — claim closed
                </Button>
              ) : workerAddr &&
                (selected.blockedWorkers ?? []).some(
                  (w) => w.toLowerCase() === workerAddr.toLowerCase(),
                ) ? (
                <Button className="h-9 w-full text-[13px]" size="lg" disabled>
                  Blocked after missed claim
                </Button>
              ) : (
                <Button
                  className="h-9 w-full text-[13px]"
                  size="lg"
                  disabled={pending}
                  onClick={() => startAccept(selected)}
                >
                  {worldVerified ? "Claim" : "Claim · World verify"}
                </Button>
              )
            ) : null}
            {selected.status === EscrowStatus.Expired ||
            selected.status === EscrowStatus.ExpiredSla ? (
              <p className="text-[12px] text-muted-foreground">
                {selected.disputeReason ??
                  "This gig timed out. Escrow was not paid to the worker."}
              </p>
            ) : null}
          </div>
        ) : null}
      </AppModal>

      <AppModal
        open={step === "idkit"}
        onClose={closeSheets}
        title="Proof of Human"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <WorldMark size={44} />
          {idkitPhase === "scanning" ? (
            <p className="text-[13px] text-muted-foreground">
              Accepting with verified nullifier…
            </p>
          ) : idkitPhase === "ok" ? (
            <p className="text-[13px] text-muted-foreground">
              Human verified. Task accepted.
            </p>
          ) : idkitPhase === "error" ? (
            <p className="text-[13px] text-[#b42318]" role="alert">
              {error ?? "Verification failed"}
            </p>
          ) : (
            <div className="w-full text-left">
              <WorldIdKitGate
                open={step === "idkit" && idkitPhase === "idle"}
                signal={workerAddr ?? identity.label ?? "proofwork-worker"}
                retryKey={idkitRetry}
                onVerified={finishLiveIdkit}
                onCancel={onIdkitCancel}
                onBlocked={onIdkitBlocked}
              />
            </div>
          )}
        </div>
        {idkitPhase === "error" ? (
          <Button
            className="w-full"
            variant="secondary"
            onPress={() => {
              setError(null);
              setIdkitPhase("idle");
              setIdkitRetry((n) => n + 1);
            }}
          >
            Try again
          </Button>
        ) : null}
      </AppModal>

      <AppModal
        open={step === "capture" && !!selected && !!meta}
        onClose={closeSheets}
        title={
          selected?.submissionForm?.fields?.length
            ? "Submit form"
            : "Submit evidence"
        }
      >
        {selected && meta ? (
          <div className="space-y-3">
            {selected.submissionForm?.fields?.length ? (
              <>
                <p className="text-[12px] text-muted-foreground">
                  Fill the agent-defined form. Answers land in the thread for
                  review.
                </p>
                <SubmissionFormPanel
                  form={selected.submissionForm}
                  taskId={selected.id}
                  disabled={pending}
                  onSubmit={runSubmitForm}
                />
                {error ? <p className="pw-error" role="alert">{error}</p> : null}
              </>
            ) : (
              <>
                <div className="pw-codeword">
                  <p className="pw-kicker">Task id · include in frame</p>
                  <p className="pw-codeword__value font-mono text-[13px]">
                    {selected.id.slice(0, 18)}…
                  </p>
                  <p className="text-[12px] text-muted-foreground">
                    Write the task id on paper and keep it visible. Evidence
                    goes to the task thread for the posting agent.
                  </p>
                </div>

                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  aria-hidden
                  tabIndex={-1}
                  onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                />

                <Button
                  variant="secondary"
                  className={`pw-camera h-auto w-full ${photoReady ? "pw-camera--ready" : ""}`}
                  onPress={() => {
                    fileRef.current?.click();
                  }}
                >
                  {photoReady ? (
                    <span className="pw-camera__shot">
                      {photoDataUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={photoDataUrl}
                          alt="Evidence preview"
                          className="pw-camera__preview"
                        />
                      ) : null}
                      Frame attached
                      <span className="font-mono text-[11px]">{photoName}</span>
                    </span>
                  ) : (
                    <span className="pw-camera__idle">
                      Attach proof photo
                      <span className="text-[12px]">
                        Camera or gallery — real file required
                      </span>
                    </span>
                  )}
                </Button>

                {error ? <p className="pw-error" role="alert">{error}</p> : null}
                <Button
                  className="w-full"
                  isDisabled={!photoReady || pending}
                  onPress={runSubmit}
                >
                  {pending ? "Sending…" : "Submit to thread"}
                </Button>
              </>
            )}
          </div>
        ) : null}
      </AppModal>

    </div>
  );
}
