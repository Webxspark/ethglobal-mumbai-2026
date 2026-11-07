"use client";

import { useRef, useState, useTransition } from "react";
import { Label, TextField, Input } from "@heroui/react";
import { ExternalLink } from "lucide-react";
import {
  EscrowStatus,
  type EscrowTask,
  type Address,
  type FormResponse,
} from "@proofwork/shared/browser";
import { TimerBadges } from "@/components/task/timer-badges";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Toast, notify } from "@/components/ui/toast";
import { SubmissionFormPanel } from "@/components/worker/submission-form";
import { ports } from "@/lib/adapters/ports";
import { callMcpTool } from "@/lib/adapters/mcp-client";
import { refreshLiveStore } from "@/lib/adapters/live-store";
import { formatWorkWindowLabel } from "@proofwork/shared/browser";
import { formatHbar } from "@/lib/format";
import { getTaskMeta } from "@/lib/task-catalog";
import { hashscanTxUrl } from "@/lib/wagmi/chains";

type Props = {
  task: EscrowTask;
  role: "worker" | "owner";
  onChanged?: () => void;
};

export function GigSidebar({ task, role, onChanged }: Props) {
  const meta = getTaskMeta(task);
  const title = task.title?.trim() || meta.title;
  const [note, setNote] = useState("Looks good — releasing.");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const lockLink =
    task.lockExplorerUrl ||
    (task.lockTxHash ? hashscanTxUrl(task.lockTxHash) : null);

  const payoutLink =
    task.payoutExplorerUrl ||
    (task.payoutTxHash
      ? task.payoutExplorerUrl ??
        `https://hashscan.io/testnet/transaction/${task.payoutTxHash}`
      : null) ||
    (task.payoutTxHash ? hashscanTxUrl(task.payoutTxHash) : null);

  function runSatisfied() {
    setError(null);
    startTransition(async () => {
      try {
        await ports.escrow.allSatisfied({
          taskId: task.id,
          owner: task.owner,
          note,
        });
        notify("Escrow released on-chain");
        onChanged?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "all_satisfied failed");
      }
    });
  }

  function runDispute() {
    setError(null);
    startTransition(async () => {
      try {
        await ports.escrow.dispute({
          taskId: task.id,
          owner: task.owner as Address,
          reason: "Evidence incomplete / agent refused",
        });
        notify("Dispute opened — funds not released.", "info");
        onChanged?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "dispute failed");
      }
    });
  }

  function onPick(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Pick an image");
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

  function runSubmitEvidence() {
    if (!photoName || !photoDataUrl) {
      setError("Add a photo before submitting evidence");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const hit = await callMcpTool<{
          attachments?: { id: string }[];
          task?: { status?: string };
        }>("send_message", {
          taskId: task.id,
          role: "worker",
          body: "Evidence attached",
          kind: "evidence",
          attachments: [
            {
              filename: photoName,
              contentType: "image/jpeg",
              data: photoDataUrl,
            },
          ],
        });
        const attId = hit.attachments?.[0]?.id;
        if (!attId) {
          throw new Error("Evidence upload failed — no attachment id returned");
        }
        if (hit.task?.status !== "SUBMITTED") {
          await ports.escrow.submit({
            taskId: task.id,
            resultCid: attId as never,
          });
        }
        await refreshLiveStore();
        setPhotoName(null);
        setPhotoDataUrl(null);
        notify("Evidence submitted");
        onChanged?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Submit failed");
      }
    });
  }

  async function runSubmitForm(formResponse: FormResponse) {
    setError(null);
    try {
      await callMcpTool("submit", {
        taskId: task.id,
        form_response: formResponse,
      });
      await refreshLiveStore();
      notify("Form submitted");
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Form submit failed");
    }
  }

  const hasForm = Boolean(task.submissionForm?.fields?.length);

  return (
    <aside className="pw-gig-side">
      <div className="space-y-3">
        <div>
          <p className="pw-kicker">Gig</p>
          <h2 className="mt-1 text-[15px] font-semibold leading-snug tracking-tight">
            {title}
          </h2>
          <p className="mt-1 text-[12px] text-muted-foreground">{meta.place}</p>
        </div>

        <div className="flex items-center justify-between gap-2">
          <StatusPill status={task.status} />
          <span className="pw-amount text-[15px]">
            {formatHbar(task.rewardWei)}
          </span>
        </div>

        <TimerBadges task={task} />

        <dl className="space-y-2 border-t border-[#e6e8eb] pt-3 text-[12px]">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Poster</dt>
            <dd className="truncate font-mono text-[11px]">
              {task.posterAgent?.trim() || "Agent"}
            </dd>
          </div>
          {formatWorkWindowLabel(task.maxWorkSecs) ? (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Max work</dt>
              <dd className="font-mono tabular-nums">
                {formatWorkWindowLabel(task.maxWorkSecs)} window
              </dd>
            </div>
          ) : null}
          {task.worker ? (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Worker</dt>
              <dd className="truncate font-mono text-[11px]">{task.worker}</dd>
            </div>
          ) : null}
        </dl>

        {lockLink ? (
          <a
            href={lockLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[12px] underline"
          >
            Locked on-chain
            <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : task.status === EscrowStatus.Submitted ||
          task.status === EscrowStatus.Accepted ||
          task.status === EscrowStatus.Open ? (
          <p className="text-[11px] text-muted-foreground">
            {task.lockTxHash
              ? "Reward locked in GigEscrow."
              : "Escrow held until " +
                (role === "owner" ? "all_satisfied" : "agent release") +
                "."}
          </p>
        ) : null}

        {payoutLink ? (
          <a
            href={payoutLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[12px] underline"
          >
            HashScan payout
            <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : null}

        {role === "worker" && task.status === EscrowStatus.Accepted ? (
          <div className="space-y-2 border-t border-[#e6e8eb] pt-3">
            {hasForm && task.submissionForm ? (
              <SubmissionFormPanel
                form={task.submissionForm}
                taskId={task.id}
                disabled={pending}
                onSubmit={runSubmitForm}
              />
            ) : (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  aria-hidden
                  tabIndex={-1}
                  onChange={(e) => onPick(e.target.files?.[0] ?? null)}
                />
                <Button
                  className="w-full"
                  variant="secondary"
                  onPress={() => fileRef.current?.click()}
                >
                  {photoName ? photoName : "Choose evidence photo"}
                </Button>
                <Button
                  className="w-full"
                  isDisabled={!photoName || pending}
                  onPress={runSubmitEvidence}
                >
                  {pending ? "Submitting…" : "Submit evidence"}
                </Button>
              </>
            )}
          </div>
        ) : null}

        {role === "owner" && task.status === EscrowStatus.Submitted ? (
          <div className="space-y-2 border-t border-[#e6e8eb] pt-3">
            <TextField
              fullWidth
              value={note}
              onChange={setNote}
              aria-label="Release note"
            >
              <Label>Release note</Label>
              <Input fullWidth variant="secondary" />
            </TextField>
            <Button
              className="w-full"
              isDisabled={pending}
              onPress={runSatisfied}
            >
              {pending ? "…" : "all_satisfied"}
            </Button>
            <Button
              className="w-full"
              variant="secondary"
              isDisabled={pending}
              onPress={runDispute}
            >
              Dispute
            </Button>
          </div>
        ) : null}

        {error ? <Toast tone="error">{error}</Toast> : null}
      </div>
    </aside>
  );
}
