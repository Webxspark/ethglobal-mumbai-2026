"use client";

import { useEffect, useState } from "react";
import type { Address, EscrowTask } from "@proofwork/shared/browser";
import { useAppState } from "@/lib/adapters/use-app-state";
import { isMcpMode } from "@/lib/adapters/mode";
import { useSession } from "@/lib/use-session";

const LS_USER = "pw.worker.userId";

export type WorkerIdentity = {
  /**
   * Escrow worker address — derived from World session nullifier when MCP
   * mode is on; otherwise session owner / stored payout wallet.
   */
  address: Address | null;
  /** PoH / Continuity nullifier for this worker (session SoT). */
  nullifier: string | null;
  /** Short label for strips / avatars. */
  label: string | null;
  ready: boolean;
};

function readStoredAddress(): Address | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(LS_USER)?.trim();
    if (v && /^0x[a-fA-F0-9]{40}$/.test(v)) return v as Address;
  } catch {
    /* ignore */
  }
  return null;
}

/** Live worker id — prefer signed-in World session. */
export function useWorkerIdentity(): WorkerIdentity {
  const { session, loading } = useSession();
  const state = useAppState();
  const mcp = isMcpMode();
  const [stored, setStored] = useState<Address | null>(null);
  const [derivedWorker, setDerivedWorker] = useState<Address | null>(null);

  useEffect(() => {
    setStored(readStoredAddress());
  }, [session?.owner, state.workerNullifier]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (session?.authenticated && session.owner) {
      window.localStorage.setItem(LS_USER, session.owner);
      setStored(session.owner as Address);
    }
  }, [session?.authenticated, session?.owner]);

  const nullifier =
    session?.nullifierHash?.trim() ||
    state.workerNullifier?.trim() ||
    null;

  // Server derives workerFromNullifier(session) — keep UI in sync.
  useEffect(() => {
    if (!mcp || !nullifier) {
      setDerivedWorker(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/worker/me", { cache: "no-store" });
        const json = (await res.json()) as {
          authenticated?: boolean;
          worker?: string;
        };
        if (
          !cancelled &&
          json.authenticated &&
          json.worker &&
          /^0x[a-fA-F0-9]{40}$/.test(json.worker)
        ) {
          setDerivedWorker(json.worker as Address);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mcp, nullifier]);

  const address =
    derivedWorker ||
    (session?.authenticated && session.owner
      ? (session.owner as Address)
      : null) ||
    stored;

  const label = address ?? (nullifier ? nullifier.slice(0, 18) : null);

  return {
    address,
    nullifier,
    label,
    ready: !loading,
  };
}

export function taskBelongsToWorker(
  task: EscrowTask,
  identity: Pick<WorkerIdentity, "address" | "nullifier">,
): boolean {
  if (
    identity.nullifier &&
    task.humanNullifier &&
    task.humanNullifier === identity.nullifier
  ) {
    return true;
  }
  if (
    identity.address &&
    task.worker &&
    task.worker.toLowerCase() === identity.address.toLowerCase()
  ) {
    return true;
  }
  return false;
}

/** Drop legacy advisory system rows from thread UI. */
export function isTeemlAdvisoryMessage(body: string): boolean {
  return /teeml|advisory\s+teeml|advisory\s+review\s+score|0g\s*tee/i.test(
    body,
  );
}
