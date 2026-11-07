import {
  ConnectAuthError,
  extractConnectToken,
  type ConnectSession,
  type ConnectTokenStore,
} from "@proofwork/shared";
import type { ToolSession } from "./session.js";

export { ConnectAuthError };

/**
 * Resolve connect binding for an HTTP or stdio call.
 * Prefer request headers; fall back to process session (stdio after connect).
 */
export function resolveRequestSession(opts: {
  headers?: Record<string, string | undefined>;
  bodyToken?: string | null;
  store: ConnectTokenStore;
  fallback?: ToolSession | null;
}): ConnectSession | null {
  const fromHeader = opts.headers
    ? extractConnectToken(opts.headers)
    : null;
  const raw = fromHeader ?? opts.bodyToken?.trim() ?? null;
  if (raw) {
    return opts.store.resolve(raw);
  }
  return opts.fallback?.get() ?? null;
}

/** Auto-bind from env when stdio boots (OpenCode paste path). */
export function tryBindEnvToken(opts: {
  store: ConnectTokenStore;
  session: ToolSession;
  env?: Record<string, string | undefined>;
}): ConnectSession | null {
  const env = opts.env ?? process.env;
  const raw = env.PROOFWORK_CONNECT_TOKEN?.trim();
  if (!raw) return null;
  try {
    const hit = opts.store.resolve(raw);
    opts.session.set(hit);
    return hit;
  } catch (err) {
    if (err instanceof ConnectAuthError) {
      console.error(
        `proofwork: PROOFWORK_CONNECT_TOKEN invalid (${err.message}) — call connect after issue_connect`,
      );
      return null;
    }
    throw err;
  }
}
