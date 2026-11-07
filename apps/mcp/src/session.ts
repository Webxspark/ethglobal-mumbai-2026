import { AsyncLocalStorage } from "node:async_hooks";
import type { ConnectSession } from "@proofwork/shared";

/**
 * Stdio / in-process session after `connect` (or env PROOFWORK_CONNECT_TOKEN).
 * HTTP requests bind per-request via Als so concurrent callers do not clobber.
 */
export type ToolSession = {
  get(): ConnectSession | null;
  set(s: ConnectSession | null): void;
};

export const connectAls = new AsyncLocalStorage<ConnectSession | null>();

export function createMemorySession(
  initial: ConnectSession | null = null,
): ToolSession {
  let cur: ConnectSession | null = initial;
  return {
    get: () => {
      const fromAls = connectAls.getStore();
      // Als present (including null) wins for this HTTP request.
      if (fromAls !== undefined) return fromAls;
      return cur;
    },
    set: (s) => {
      cur = s;
    },
  };
}

/** Run a tool call with a request-scoped connect binding (HTTP bearer path). */
export function withConnectBinding<T>(
  binding: ConnectSession | null | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (binding === undefined) return fn();
  return connectAls.run(binding, fn);
}
