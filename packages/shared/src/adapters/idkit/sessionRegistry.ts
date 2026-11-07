/**
 * World ID v4 session bindings for repeatable sign-in.
 * Enrollment nullifier is the stable account id; session_id is continuity.
 * session_nullifier is per-proof replay protection only.
 *
 * Optionally persists to disk so Next restarts don't orphan returning users
 * who still hold `pw_world_session_id` in localStorage.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type WorldSessionBinding = {
  readonly sessionId: string;
  readonly nullifierHash: string;
  readonly createdAt: number;
};

export type WorldSessionRegistry = {
  /** Link a verified enrollment session to its uniqueness nullifier. */
  bindEnrollment(i: {
    sessionId: string;
    nullifierHash: string;
    now?: number;
  }): WorldSessionBinding;
  getBySession(sessionId: string): WorldSessionBinding | null;
  getByNullifier(nullifierHash: string): WorldSessionBinding | null;
  /**
   * Record a session_nullifier after a cryptographically verified session proof.
   * Returns false if this proof was already accepted (replay).
   */
  consumeSessionNullifier(sessionNullifier: string): boolean;
  clear(): void;
};

type DiskShape = {
  bindings: WorldSessionBinding[];
  usedSessionNullifiers: string[];
};

function defaultPersistPath(): string | null {
  // Web/login process only — keep out of the git tree.
  const fromEnv = process.env.PROOFWORK_WORLD_SESSION_PATH?.trim();
  if (fromEnv) return fromEnv;
  try {
    return join(process.cwd(), ".data", "world-sessions.json");
  } catch {
    return null;
  }
}

export function createWorldSessionRegistry(opts?: {
  persistPath?: string | null;
}): WorldSessionRegistry {
  const bySession = new Map<string, WorldSessionBinding>();
  const byNullifier = new Map<string, WorldSessionBinding>();
  const usedSessionNullifiers = new Set<string>();
  const persistPath =
    opts && "persistPath" in opts ? opts.persistPath : defaultPersistPath();

  function hydrate() {
    if (!persistPath || !existsSync(persistPath)) return;
    try {
      const raw = readFileSync(persistPath, "utf8");
      const parsed = JSON.parse(raw) as DiskShape;
      for (const row of parsed.bindings ?? []) {
        if (!row?.sessionId || !row?.nullifierHash) continue;
        bySession.set(row.sessionId, row);
        byNullifier.set(row.nullifierHash, row);
      }
      for (const sn of parsed.usedSessionNullifiers ?? []) {
        if (sn) usedSessionNullifiers.add(sn);
      }
    } catch (err) {
      console.warn("[world-session] failed to load persist file", err);
    }
  }

  function flush() {
    if (!persistPath) return;
    try {
      mkdirSync(dirname(persistPath), { recursive: true });
      const payload: DiskShape = {
        bindings: [...bySession.values()],
        usedSessionNullifiers: [...usedSessionNullifiers],
      };
      writeFileSync(persistPath, JSON.stringify(payload, null, 2), "utf8");
    } catch (err) {
      console.warn("[world-session] failed to persist", err);
    }
  }

  hydrate();

  return {
    bindEnrollment(i) {
      const sessionId = i.sessionId.trim();
      const nullifierHash = i.nullifierHash.trim();
      if (!sessionId.startsWith("session_")) {
        throw new Error("sessionId must look like session_<hex>");
      }
      if (!nullifierHash) throw new Error("nullifierHash required");

      const existingByNullifier = byNullifier.get(nullifierHash);
      if (existingByNullifier) {
        // Do not silently replace — docs treat rebinding as an account-security op.
        return existingByNullifier;
      }

      const existingBySession = bySession.get(sessionId);
      if (
        existingBySession &&
        existingBySession.nullifierHash !== nullifierHash
      ) {
        throw new Error("session_id already bound to a different nullifier");
      }

      const row: WorldSessionBinding = {
        sessionId,
        nullifierHash,
        createdAt: i.now ?? Math.floor(Date.now() / 1000),
      };
      bySession.set(sessionId, row);
      byNullifier.set(nullifierHash, row);
      flush();
      return row;
    },

    getBySession(sessionId) {
      return bySession.get(sessionId.trim()) ?? null;
    },

    getByNullifier(nullifierHash) {
      return byNullifier.get(nullifierHash.trim()) ?? null;
    },

    consumeSessionNullifier(sessionNullifier) {
      const key = sessionNullifier.trim();
      if (!key) return false;
      if (usedSessionNullifiers.has(key)) return false;
      usedSessionNullifiers.add(key);
      flush();
      return true;
    },

    clear() {
      bySession.clear();
      byNullifier.clear();
      usedSessionNullifiers.clear();
      flush();
    },
  };
}

/** Process-local registry — web login + verify share one Node process. */
export const sharedWorldSessionRegistry = createWorldSessionRegistry();
