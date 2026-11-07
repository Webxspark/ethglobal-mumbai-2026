import {
  ConnectAuthError,
  EscrowStatus,
  GIG_CATEGORIES,
  RefundRaceError,
  TERMS_VERSION,
  UnknownPotError,
  formatFormCardBody,
  formatHbarDecimal,
  gateRequestApproval,
  gateWorkerAccept,
  isSessionReplayAckProof,
  matchesTaskQuery,
  parseSubmissionForm,
  sortTasks,
  taskTimerFields,
  validateFormResponse,
  workerFromNullifier,
  evaluateDisputeEligibility,
  type Address,
  type AgentPassAttestation,
  type Cid,
  type ConnectSession,
  type EscrowTask,
  type FormCardRow,
  type FormResponse,
  type GigCategory,
  type PotId,
  type SubmissionForm,
  type TaskId,
  type TaskNotifyKind,
  type ThreadAttachment,
  type ThreadRole,
  type UnixSecs,
  type Wei,
} from "@proofwork/shared";
import type { ComposedPorts } from "@proofwork/shared/compose";
import {
  createMemorySession,
  type ToolSession,
} from "./session.js";
import {
  getTaskPayout,
  claimNullifierStoreFromProfiles,
  getClaimNullifierForAccount,
  getWorkerPayout,
  isDemoWorkerId,
  repairDemoWorkerClaims,
  resolvePayoutAddress,
  setWorkerPayout,
  type ClaimRekeyPort,
} from "./worker-profiles.js";
import {
  hashscanTx,
  PayoutSetupError,
  releaseOnChainPayout,
} from "./onchain-payout.js";
import {
  gigEscrowConfigured,
  lockGigEscrow,
} from "./onchain-escrow.js";
import {
  extractDocumentText,
  isImageMime,
  prepareAttachmentBytes,
} from "./attachment-media.js";
import {
  agentGuidePath,
  agentGuideUri,
  GUIDE_TOOL_TIP,
  loadAgentGuide,
} from "./agent-guide.js";
import { formatMonitorNextSteps } from "./monitor-hints.js";

/**
 * Agent tools (x402-paid mutations) + worker/owner surfaces.
 *
 * Posting agent `all_satisfied` is the ONLY happy path that releases escrow.
 * `verify` stays listed but returns a clear demotion error.
 *
 * notify_url + wait_task_event wake the posting agent when the gig moves.
 * `connect` / `issue_connect` bind an agent to a pot (HTTP bearer or stdio session).
 */
export const TOOL_TABLE = [
  { name: "issue_connect", paid: false },
  { name: "connect", paid: false },
  { name: "accept_terms", paid: false },
  { name: "authorize_connect", paid: false },
  { name: "ensure_account", paid: false },
  { name: "get_account", paid: false },
  { name: "get_guide", paid: false },
  { name: "post", paid: true },
  /** Alias of post — requires deadline_at + max_work_secs. */
  { name: "post_gig", paid: true },
  { name: "get", paid: false },
  { name: "list", paid: false },
  { name: "pot_status", paid: false },
  { name: "pot_deposit", paid: false },
  { name: "pot_set_threshold", paid: false },
  { name: "request_approval", paid: true },
  { name: "cancel", paid: true },
  { name: "accept", paid: false },
  { name: "submit", paid: false },
  { name: "extend_claim", paid: false },
  { name: "thread_list", paid: false },
  { name: "thread_post", paid: false },
  { name: "list_messages", paid: false },
  { name: "send_message", paid: false },
  { name: "get_attachment", paid: false },
  { name: "worker_set_payout", paid: false },
  { name: "worker_get_payout", paid: false },
  { name: "worker_claim_nullifier", paid: false },
  { name: "upload_attachment", paid: false },
  { name: "all_satisfied", paid: false },
  { name: "request_changes", paid: false },
  { name: "dispute", paid: false },
  { name: "resolve_dispute", paid: false },
  { name: "list_task_events", paid: false },
  { name: "wait_task_event", paid: false },
  { name: "list_my_gigs_updates", paid: false },
  { name: "wait_any_event", paid: false },
  /** @deprecated — TeePathDemoted; kept so old clients get a clear error. */
  { name: "verify", paid: false },
] as const;

export type ToolName = (typeof TOOL_TABLE)[number]["name"];
export type PaidToolName = Extract<
  (typeof TOOL_TABLE)[number],
  { paid: true }
>["name"];

export type PaidCtx = { readonly actor: Address; readonly receipt: string };

export type ToolDeps = ComposedPorts;

export class BadRequest extends Error {
  readonly status = 400 as const;
  constructor(message: string) {
    super(message);
    this.name = "BadRequest";
  }
}

export class NotFound extends Error {
  readonly status = 404 as const;
  constructor(message: string) {
    super(message);
    this.name = "NotFound";
  }
}

const VERIFY_WINDOW_SECS = 3600;

/** Retired smoke/demo pot — never seeded; reject if an agent still asks for it. */
const RETIRED_DEMO_POT =
  "0xp0t000000000000000000000000000000000001".toLowerCase();

function asClaimRekey(escrow: ComposedPorts["escrow"]): ClaimRekeyPort | null {
  const e = escrow as ComposedPorts["escrow"] & Partial<ClaimRekeyPort>;
  if (typeof e.rekeyClaim === "function" && typeof e.list === "function") {
    return e as ClaimRekeyPort;
  }
  return null;
}

function parsePotId(v: string | undefined | null, field = "potId"): PotId {
  if (!v || typeof v !== "string") throw new BadRequest(`${field} required`);
  const id = v.trim() as PotId;
  if (id.toLowerCase() === RETIRED_DEMO_POT) {
    throw new NotFound("Unknown pot");
  }
  return id;
}

function resolvePotId(
  inputPotId: string | undefined | null,
  bound: ConnectSession | null,
): PotId {
  if (bound?.potId) {
    if (
      inputPotId &&
      typeof inputPotId === "string" &&
      inputPotId.trim() &&
      inputPotId.trim().toLowerCase() !== bound.potId.toLowerCase()
    ) {
      throw new BadRequest("potId does not match connected bearer pot");
    }
    return bound.potId;
  }
  if (inputPotId && typeof inputPotId === "string" && inputPotId.trim()) {
    return parsePotId(inputPotId.trim());
  }
  throw new BadRequest("potId required (pass it or call connect first)");
}

function parseGigCategory(raw: unknown): GigCategory | undefined {
  if (raw == null || raw === "") return undefined;
  if (typeof raw !== "string") {
    throw new BadRequest(
      `category must be one of: ${GIG_CATEGORIES.join(", ")}`,
    );
  }
  const hit = raw.trim().toLowerCase();
  if (!(GIG_CATEGORIES as readonly string[]).includes(hit)) {
    throw new BadRequest(
      `category must be one of: ${GIG_CATEGORIES.join(", ")}`,
    );
  }
  return hit as GigCategory;
}

/**
 * Connected agents may only see their own pot's tasks.
 * Unbound web/marketplace callers keep the explicit potId / open board.
 */
function resolveListPotFilter(
  inputPotId: string | undefined | null,
  session: ConnectSession | null,
): PotId | undefined {
  if (session?.potId) {
    if (
      inputPotId &&
      inputPotId.trim() &&
      inputPotId.trim().toLowerCase() !== session.potId.toLowerCase()
    ) {
      throw new BadRequest("list is scoped to the connected bearer pot");
    }
    return session.potId;
  }
  if (inputPotId && inputPotId.trim()) {
    return parsePotId(inputPotId.trim());
  }
  return undefined;
}

function parseTaskId(v: string): TaskId {
  if (!v || typeof v !== "string") throw new BadRequest("taskId required");
  return v as TaskId;
}

function parseWei(v: string): Wei {
  if (!/^\d+$/.test(v)) throw new BadRequest("rewardWei must be decimal digits");
  return BigInt(v) as Wei;
}

/** Format tinybar as decimal HBAR for agent-facing strings (no unit suffix). */
export function formatHbar(tinybar: bigint): string {
  return formatHbarDecimal(tinybar, 8);
}

/** Same as {@link formatHbar} plus ` HBAR` suffix — JSON balanceHbar / rewardHbar fields. */
function hbarLabel(tinybar: bigint): string {
  return `${formatHbar(tinybar)} HBAR`;
}

function publicOwnerPotUrl(): string {
  const base = (
    process.env.PROOFWORK_PUBLIC_URL ?? "http://127.0.0.1:38471"
  ).replace(/\/$/, "");
  return `${base}/owner/pot`;
}

/** Clear underfunded message — agents should send the human to the web panel. */
export function potUnderfundedMessage(balanceWei: bigint): string {
  return `Pot balance ${hbarLabel(balanceWei)}; ask your human to fund at ${publicOwnerPotUrl()}`;
}

function parseAddress(v: string | undefined, fallback: Address): Address {
  if (!v) return fallback;
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) {
    throw new BadRequest("address must be 0x + 40 hex");
  }
  return v as Address;
}

function requireAddress(v: string | undefined, field: string): Address {
  if (!v || typeof v !== "string" || !v.trim()) {
    throw new BadRequest(`${field} required`);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(v.trim())) {
    throw new BadRequest(`${field} must be 0x + 40 hex`);
  }
  return v.trim() as Address;
}

const THREAD_ROLES = new Set<ThreadRole>([
  "owner",
  "worker",
  "agent",
  "system",
]);

function parseRole(v: string | undefined): ThreadRole {
  if (!v || !THREAD_ROLES.has(v as ThreadRole)) {
    throw new BadRequest("role must be owner|worker|agent|system");
  }
  return v as ThreadRole;
}

function parseOptionalPositiveInt(
  raw: unknown,
  field: string,
): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new BadRequest(`${field} must be a positive integer`);
  }
  return n;
}

/** Accept ISO string or unix seconds. */
function parseUnixTime(raw: unknown, field: string): UnixSecs | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) {
      throw new BadRequest(`${field} must be a positive unix/ISO time`);
    }
    return Math.floor(raw) as UnixSecs;
  }
  if (typeof raw === "string") {
    if (/^\d+$/.test(raw)) return Number(raw) as UnixSecs;
    const ms = Date.parse(raw);
    if (Number.isNaN(ms)) throw new BadRequest(`${field} must be ISO or unix`);
    return Math.floor(ms / 1000) as UnixSecs;
  }
  throw new BadRequest(`${field} must be ISO or unix`);
}

function parseExpiresAt(raw: unknown): UnixSecs | null {
  return parseUnixTime(raw, "expires_at");
}

function parseDeadlineAt(raw: unknown): UnixSecs | null {
  return parseUnixTime(raw, "deadline_at");
}

function parseTags(raw: unknown): string[] {
  if (raw == null || raw === "") return [];
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t).trim()).filter(Boolean).slice(0, 12);
  }
  if (typeof raw === "string") {
    return raw
      .split(/[, ]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 12);
  }
  throw new BadRequest("tags must be string or string[]");
}

function parseNotifyUrl(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") throw new BadRequest("notify_url must be string");
  const u = raw.trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) {
    throw new BadRequest("notify_url must be http(s)");
  }
  return u;
}

export function createTools(
  deps: ToolDeps,
  session: ToolSession = createMemorySession(),
) {
  /** Idempotent pot_deposit when web re-posts the same on-chain tx hash. */
  const creditedExternalTx = new Set<string>();

  function bound(): ConnectSession | null {
    return session.get();
  }

  function defaultPostGeo(): { lat: number; lng: number } {
    const lat = Number(process.env.PROOFWORK_DEFAULT_GEO_LAT ?? "19.076");
    const lng = Number(process.env.PROOFWORK_DEFAULT_GEO_LNG ?? "72.877");
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new BadRequest("PROOFWORK_DEFAULT_GEO_LAT/LNG must be valid numbers");
    }
    return { lat, lng };
  }

  function resolvePostGeo(geo?: { lat: number; lng: number }) {
    if (
      geo &&
      Number.isFinite(geo.lat) &&
      Number.isFinite(geo.lng)
    ) {
      return geo;
    }
    return defaultPostGeo();
  }

  async function projectLatest(task: EscrowTask | null) {
    const events = deps.escrow.drainEvents();
    const projection = await deps.projector.project(task, events);
    if (projection.failures.length > 0) {
      console.error(
        `[projection] task=${task?.id ?? "null"} events=${events.map((e) => e.type).join(",")}: ${projection.failures.join("; ")}`,
      );
    }
    return projection;
  }

  function withPayoutMeta(task: EscrowTask) {
    const pay = getTaskPayout(task.id);
    if (!pay) return task;
    return {
      ...task,
      payoutTxHash: pay.txHash,
      payoutAddress: pay.to,
      payoutExplorerUrl: hashscanTx(pay.txHash),
    };
  }

  function enrichTask(task: EscrowTask) {
    return {
      ...withPayoutMeta(task),
      ...taskTimerFields(task),
    };
  }

  const TERMINAL = new Set<string>([
    EscrowStatus.Paid,
    EscrowStatus.Expired,
    EscrowStatus.ExpiredSla,
    EscrowStatus.Cancelled,
    EscrowStatus.Refunded,
  ]);

  const deadlineSoonEmitted = new Set<string>();
  const DEADLINE_SOON_SECS = 30 * 60;
  const RESPOND_SOON_SECS = 30 * 60;

  type PendingActionKind =
    | "review_submission"
    | "reply_to_worker"
    | "follow_up";

  type PendingAction = {
    kind: PendingActionKind;
    taskId: string;
    title: string;
    status: string;
    action: string;
  };

  function pendingNotifications(actions: PendingAction[]) {
    return actions.map((p) => ({
      kind: p.kind,
      taskId: p.taskId,
      title: p.title,
      message: p.action,
    }));
  }

  function isOpenGig(g: EscrowTask): boolean {
    return !TERMINAL.has(g.status);
  }

  function titleOf(g: EscrowTask): string {
    return g.title?.trim() || g.id.slice(0, 12);
  }

  async function agentOpenGigs(potId: PotId): Promise<EscrowTask[]> {
    const gigs = await deps.escrow.list({ potId });
    return gigs.filter(isOpenGig);
  }

  async function maybeEmitDeadlineSoon(gigs: EscrowTask[]): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    for (const g of gigs) {
      const dl = g.deadlineAt ?? g.expiresAt;
      if (dl == null) continue;
      if (dl - now > DEADLINE_SOON_SECS || dl - now < 0) continue;
      if (deadlineSoonEmitted.has(g.id)) continue;
      deadlineSoonEmitted.add(g.id);
      try {
        await deps.notify.emit({
          taskId: g.id,
          event: "deadline_soon",
          notifyUrl: g.notifyUrl,
          payload: {
            status: g.status,
            deadlineAt: dl,
            title: titleOf(g),
          },
        });
      } catch {
        /* best-effort */
      }
    }
  }

  async function buildPendingActions(
    gigs: EscrowTask[],
  ): Promise<PendingAction[]> {
    const out: PendingAction[] = [];
    const now = Math.floor(Date.now() / 1000);
    for (const g of gigs) {
      const title = titleOf(g);
      if (g.status === EscrowStatus.Submitted) {
        out.push({
          kind: "review_submission",
          taskId: g.id,
          title,
          status: g.status,
          action: `review_submission: open thread + get_attachment(include_data), then all_satisfied, request_changes, or (after messaging + ~60s) dispute on "${title}" — decide yourself; do not ask the human owner`,
        });
      }
      if (g.status === EscrowStatus.Disputed) {
        out.push({
          kind: "follow_up",
          taskId: g.id,
          title,
          status: g.status,
          action: `resolve_dispute: legacy DISPUTED on "${title}" — outcome release (pay worker) or reopen`,
        });
      }
      if (
        g.status === EscrowStatus.Accepted ||
        g.status === EscrowStatus.Submitted
      ) {
        const thread = await deps.thread.list(g.id);
        const last = thread[thread.length - 1];
        if (
          last &&
          (last.role === "worker" ||
            last.kind === "evidence" ||
            last.kind === "form_response")
        ) {
          out.push({
            kind: "reply_to_worker",
            taskId: g.id,
            title,
            status: g.status,
            action: `reply_to_worker: send_message on "${title}" — acknowledge, clarify, or nudge promptly`,
          });
        }
      }
      if (
        g.respondDeadline != null &&
        g.status === EscrowStatus.Submitted
      ) {
        const left = g.respondDeadline - now;
        if (left <= RESPOND_SOON_SECS && left >= 0) {
          out.push({
            kind: "follow_up",
            taskId: g.id,
            title,
            status: g.status,
            action: `follow_up: respond SLA ${left}s left on "${title}" — review evidence and decide now`,
          });
        }
      }
      const dl = g.deadlineAt ?? g.expiresAt;
      if (
        dl != null &&
        dl - now <= DEADLINE_SOON_SECS &&
        dl - now >= 0 &&
        isOpenGig(g)
      ) {
        out.push({
          kind: "follow_up",
          taskId: g.id,
          title,
          status: g.status,
          action: `follow_up: deadline soon on "${title}" — message worker or extend_claim if justified`,
        });
      }
    }
    const seen = new Set<string>();
    return out.filter((a) => {
      const k = `${a.taskId}:${a.action}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  async function resolveMonitorCursor(
    potId: PotId,
    afterId?: string | null,
  ): Promise<string | null> {
    const open = await agentOpenGigs(potId);
    const ids = open.map((g) => g.id);
    if (!ids.length) return afterId ?? null;
    const events = deps.notify.listSince(ids, afterId ?? null);
    if (!events.length) return afterId ?? null;
    return events[events.length - 1]!.id;
  }

  async function buildMonitorNextSteps(potId: PotId, cursor?: string | null) {
    const cur = await resolveMonitorCursor(potId, cursor ?? null);
    return formatMonitorNextSteps(cur);
  }

  async function buildAttention(potId: PotId | null): Promise<string | null> {
    if (!potId) return null;
    try {
      const open = await agentOpenGigs(potId);
      await maybeEmitDeadlineSoon(open);
      const pending = await buildPendingActions(open);
      if (!pending.length && !open.length) return null;
      if (!pending.length) {
        return `Stay active: ${open.length} open gig(s) — loop wait_any_event with cursor (see get_guide).`;
      }
      const head = pending
        .slice(0, 3)
        .map((p) => p.kind)
        .join(", ");
      const more =
        pending.length > 3 ? ` (+${pending.length - 3} more)` : "";
      return `Autonomous work pending (${head}${more}) — act without owner approval unless budget/ambiguous; loop wait_any_event.`;
    } catch {
      return null;
    }
  }

  function potIdFromResult(result: unknown): PotId | null {
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      return null;
    }
    const r = result as {
      potId?: unknown;
      pot?: { potId?: unknown };
    };
    if (typeof r.potId === "string" && r.potId) return r.potId as PotId;
    if (typeof r.pot?.potId === "string" && r.pot.potId) {
      return r.pot.potId as PotId;
    }
    return null;
  }

  async function withAttention(result: unknown): Promise<unknown> {
    // Arrays (list/get fans) stay arrays — clients iterate them.
    if (Array.isArray(result)) return result;
    const potId = bound()?.potId ?? potIdFromResult(result);
    const attention = await buildAttention(potId);
    if (!attention) return result;
    if (result && typeof result === "object") {
      return { ...(result as Record<string, unknown>), attention };
    }
    return { result, attention };
  }

  function publicEventName(kind: TaskNotifyKind): string {
    if (kind === "evidence_submitted") return "submitted";
    return kind;
  }

  async function notify(
    task: EscrowTask,
    event: TaskNotifyKind,
    payload: Record<string, unknown> = {},
  ) {
    // Best-effort — never fail the user action on webhook/log issues.
    try {
      await deps.notify.emit({
        taskId: task.id,
        event,
        notifyUrl: task.notifyUrl,
        payload: {
          status: task.status,
          ...payload,
        },
      });
    } catch (err) {
      console.warn(
        `[notify] emit ${event} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const handlers = {
    /**
     * Owner mint — short-lived proofwork_connect token bound to a pot.
     * Mock/stub World is fine; Agent Pass still gates over-threshold spends on post.
     */
    async issue_connect(input: {
      potId?: string;
      owner?: string;
      notify_url?: string;
      notifyUrl?: string;
      max_bounty_wei?: string;
      maxBountyWei?: string;
      ttl_secs?: number | string;
      ttlSecs?: number | string;
      label?: string;
    }) {
      const potId = resolvePotId(input.potId, bound());
      const pot = await deps.pot.status(potId);
      const owner = parseAddress(input.owner, pot.owner);
      const ttlSecs = parseOptionalPositiveInt(
        input.ttl_secs ?? input.ttlSecs,
        "ttl_secs",
      );
      const maxRaw = input.max_bounty_wei ?? input.maxBountyWei;
      const maxBountyWei =
        maxRaw != null && maxRaw !== "" ? parseWei(String(maxRaw)) : null;
      const notifyUrl = parseNotifyUrl(input.notify_url ?? input.notifyUrl);
      const record = deps.connect.mint({
        potId,
        owner,
        notifyUrl,
        maxBountyWei,
        ttlSecs: ttlSecs ?? undefined,
        label: input.label ?? null,
      });
      return {
        token: record.token,
        potId: record.potId,
        owner: record.owner,
        notifyUrl: record.notifyUrl,
        maxBountyWei:
          record.maxBountyWei == null ? null : record.maxBountyWei.toString(),
        expiresAt: record.expiresAt,
        label: record.label,
        header: {
          authorization: `Bearer ${record.token}`,
          "X-PROOFWORK-CONNECT": record.token,
        },
        hint: "Paste token into OpenCode env PROOFWORK_CONNECT_TOKEN (or call connect). Send Authorization: Bearer <token> on HTTP MCP tool calls so Review inbox + agent share this pot.",
      };
    },

    /**
     * Agent onboarding.
     * - no token / device_code → start device flow (terms + authorize URL)
     * - device_code → poll until human approves (then bind)
     * - token / PROOFWORK_CONNECT_TOKEN → bind immediately
     */
    async connect(input: {
      token?: string;
      device_code?: string;
      deviceCode?: string;
      label?: string;
      notify_url?: string;
      notifyUrl?: string;
    }) {
      const deviceCode =
        (typeof input.device_code === "string" && input.device_code.trim()) ||
        (typeof input.deviceCode === "string" && input.deviceCode.trim()) ||
        "";
      const raw =
        (typeof input.token === "string" && input.token.trim()) ||
        process.env.PROOFWORK_CONNECT_TOKEN?.trim() ||
        "";

      if (deviceCode) {
        const rec = deps.device.poll(deviceCode);
        if (!rec) throw new BadRequest("unknown device_code");
        if (rec.status === "expired") {
          throw new BadRequest("device_code expired — call connect again");
        }
        if (rec.status === "denied") {
          throw new BadRequest("human denied this connect request");
        }
        if (rec.status === "authorized" && rec.token) {
          let hit: ConnectSession;
          try {
            hit = deps.connect.resolve(rec.token);
          } catch (err) {
            throw new BadRequest(
              err instanceof Error ? err.message : "invalid connect token",
            );
          }
          session.set(hit);
          const pot = await deps.pot.status(hit.potId);
          return {
            ok: true,
            status: "authorized" as const,
            token: hit.token,
            potId: hit.potId,
            owner: hit.owner,
            nullifierHash: hit.nullifierHash,
            termsVersion: hit.termsVersion,
            notifyUrl: hit.notifyUrl,
            maxBountyWei:
              hit.maxBountyWei == null ? null : hit.maxBountyWei.toString(),
            expiresAt: hit.expiresAt,
            pot: {
              balanceWei: pot.balanceWei.toString(),
              spentWei: pot.spentWei.toString(),
              agentPassThresholdWei: pot.agentPassThresholdWei.toString(),
            },
            header: {
              authorization: `Bearer ${hit.token}`,
              "X-PROOFWORK-CONNECT": hit.token,
            },
            wait: {
              tools: ["wait_any_event", "list_my_gigs_updates", "get_account"],
              tip: "Start monitoring immediately — see next_steps. Never ask the owner to poll.",
            },
            next_steps: await buildMonitorNextSteps(hit.potId),
          };
        }
        const publicAppUrl =
          process.env.PROOFWORK_PUBLIC_URL ?? "http://127.0.0.1:38471";
        return {
          ok: false,
          status: rec.status,
          device_code: rec.deviceCode,
          user_code: rec.userCode,
          terms_version: rec.termsVersion,
          authorize_url: `${publicAppUrl.replace(/\/$/, "")}${rec.authorizePath}`,
          expires_at: rec.expiresAt,
          next:
            rec.status === "pending_terms"
              ? "Call accept_terms({ device_code, agreed: true, terms_version })"
              : "Ask the human to open authorize_url (World ID gated) and approve",
        };
      }

      if (raw) {
        let hit: ConnectSession;
        try {
          hit = deps.connect.resolve(raw);
        } catch (err) {
          throw new BadRequest(
            err instanceof Error ? err.message : "invalid connect token",
          );
        }
        session.set(hit);
        const pot = await deps.pot.status(hit.potId);
        return {
          ok: true,
          status: "authorized" as const,
          token: hit.token,
          potId: hit.potId,
          owner: hit.owner,
          nullifierHash: hit.nullifierHash,
          termsVersion: hit.termsVersion,
          notifyUrl: hit.notifyUrl,
          maxBountyWei:
            hit.maxBountyWei == null ? null : hit.maxBountyWei.toString(),
          expiresAt: hit.expiresAt,
          pot: {
            balanceWei: pot.balanceWei.toString(),
            spentWei: pot.spentWei.toString(),
            agentPassThresholdWei: pot.agentPassThresholdWei.toString(),
          },
          wait: {
            tools: ["wait_any_event", "list_my_gigs_updates", "get_account"],
            tip: "Start monitoring immediately — see next_steps. Never ask the owner to poll.",
          },
          next_steps: await buildMonitorNextSteps(hit.potId),
        };
      }

      // No token — kick off device authorize (T&C + URL).
      const publicAppUrl =
        process.env.PROOFWORK_PUBLIC_URL ?? "http://127.0.0.1:38471";
      const started = deps.device.start({
        publicAppUrl,
        label: input.label ?? null,
        notifyUrl: parseNotifyUrl(input.notify_url ?? input.notifyUrl),
      });
      return {
        ok: false,
        status: "authorization_required" as const,
        device_code: started.device.deviceCode,
        user_code: started.device.userCode,
        terms: started.terms,
        terms_version: started.termsVersion,
        authorize_url: started.authorizeUrl,
        expires_at: started.device.expiresAt,
        next: `1) Read terms. 2) accept_terms({ device_code, agreed: true, terms_version: "${started.termsVersion}" }). 3) Human opens authorize_url with World ID. 4) Poll connect({ device_code }).`,
      };
    },

    /** Agent must explicitly agree before the human can approve. */
    async accept_terms(input: {
      device_code?: string;
      deviceCode?: string;
      agreed?: boolean;
      terms_version?: string;
      termsVersion?: string;
    }) {
      const deviceCode =
        (typeof input.device_code === "string" && input.device_code.trim()) ||
        (typeof input.deviceCode === "string" && input.deviceCode.trim()) ||
        "";
      if (!deviceCode) throw new BadRequest("device_code required");
      if (input.agreed !== true) {
        throw new BadRequest(
          "agreed must be true — pass { agreed: true, terms_version }",
        );
      }
      try {
        const rec = deps.device.acceptTerms({
          deviceCode,
          agreed: true,
          termsVersion: input.terms_version ?? input.termsVersion,
        });
        const publicAppUrl =
          process.env.PROOFWORK_PUBLIC_URL ?? "http://127.0.0.1:38471";
        return {
          ok: true,
          status: rec.status,
          device_code: rec.deviceCode,
          user_code: rec.userCode,
          terms_version: rec.termsVersion,
          authorize_url: `${publicAppUrl.replace(/\/$/, "")}${rec.authorizePath}`,
          expires_at: rec.expiresAt,
          next: "Human opens authorize_url, signs in with World ID, approves. Then poll connect({ device_code }).",
        };
      } catch (err) {
        throw new BadRequest(
          err instanceof Error ? err.message : "accept_terms failed",
        );
      }
    },

    /**
     * Web panel after World gate — bind device code to this human's pot.
     * Not for agents to call with a guessed potId.
     */
    async authorize_connect(input: {
      device_code?: string;
      deviceCode?: string;
      nullifierHash?: string;
      potId?: string;
      owner?: string;
      ttl_secs?: number | string;
      ttlSecs?: number | string;
    }) {
      const deviceCode =
        (typeof input.device_code === "string" && input.device_code.trim()) ||
        (typeof input.deviceCode === "string" && input.deviceCode.trim()) ||
        "";
      if (!deviceCode) throw new BadRequest("device_code required");
      if (!input.nullifierHash?.trim()) {
        throw new BadRequest("nullifierHash required");
      }
      const account = deps.accounts.ensureForNullifier(
        input.nullifierHash.trim(),
      );
      const potId = input.potId?.trim()
        ? parsePotId(input.potId.trim())
        : account.potId;
      if (potId !== account.potId) {
        throw new BadRequest("potId does not belong to this nullifier");
      }
      const owner = parseAddress(input.owner, account.owner);
      const ttlSecs = parseOptionalPositiveInt(
        input.ttl_secs ?? input.ttlSecs,
        "ttl_secs",
      );
      try {
        const { device, token } = deps.device.approve({
          deviceCode,
          nullifierHash: account.nullifierHash,
          potId,
          owner,
          ttlSecs: ttlSecs ?? undefined,
        });
        return {
          ok: true,
          status: device.status,
          device_code: device.deviceCode,
          potId: token.potId,
          owner: token.owner,
          nullifierHash: token.nullifierHash,
          termsVersion: token.termsVersion ?? TERMS_VERSION,
          token: token.token,
          expiresAt: token.expiresAt,
          // Agent polls connect — we still return token for the web "copy" UI.
        };
      } catch (err) {
        throw new BadRequest(
          err instanceof Error ? err.message : "authorize_connect failed",
        );
      }
    },

    /** Web sign-in — create/fetch the pot for this World nullifier. */
    async ensure_account(input: {
      nullifierHash?: string;
      label?: string;
    }) {
      if (!input.nullifierHash?.trim()) {
        throw new BadRequest("nullifierHash required");
      }
      const account = deps.accounts.ensureForNullifier(
        input.nullifierHash.trim(),
        { label: input.label ?? null },
      );
      const pot = await deps.pot.status(account.potId);
      return {
        nullifierHash: account.nullifierHash,
        potId: account.potId,
        owner: account.owner,
        createdAt: account.createdAt,
        label: account.label,
        pot: {
          currency: "HBAR" as const,
          balanceWei: pot.balanceWei.toString(),
          spentWei: pot.spentWei.toString(),
          agentPassThresholdWei: pot.agentPassThresholdWei.toString(),
          balanceHbar: hbarLabel(pot.balanceWei),
          spentHbar: hbarLabel(pot.spentWei),
          agentPassThresholdHbar: hbarLabel(pot.agentPassThresholdWei),
        },
      };
    },

    /** Everything the bound human has — pot, gigs, claims, unread. */
    async get_account(input: { potId?: string } = {}) {
      const sessionHit = bound();
      if (!sessionHit && !input.potId) {
        throw new ConnectAuthError(
          "get_account requires connect token (or call connect first)",
        );
      }
      const potId = resolvePotId(input.potId, sessionHit);
      const pot = await deps.pot.status(potId);
      const account = deps.accounts.getByPotId(potId);
      const gigs = await deps.escrow.list({ potId });
      const claims = gigs.filter(
        (g) =>
          g.status === EscrowStatus.Accepted ||
          g.status === EscrowStatus.Submitted,
      );
      const unread: Array<{
        taskId: string;
        messageId: string;
        role: string;
        kind: string;
        body: string;
        createdAt: number;
      }> = [];
      const gigsOut = [];
      for (const g of gigs) {
        const thread = await deps.thread.list(g.id);
        // Unread ≈ worker / system chatter the agent has not released on.
        for (const m of thread) {
          if (m.role === "agent") continue;
          if (
            g.status === EscrowStatus.Submitted ||
            g.status === EscrowStatus.Accepted ||
            m.kind === "evidence"
          ) {
            if (m.role === "worker" || m.kind === "evidence") {
              unread.push({
                taskId: g.id,
                messageId: m.id,
                role: m.role,
                kind: m.kind,
                body: m.body.slice(0, 280),
                createdAt: m.createdAt,
              });
            }
          }
        }
        const pay = getTaskPayout(g.id);
        gigsOut.push({
          taskId: g.id,
          status: g.status,
          rewardWei: g.rewardWei.toString(),
          rewardHbar: hbarLabel(g.rewardWei),
          currency: "HBAR" as const,
          worker: g.worker,
          humanNullifier: g.humanNullifier,
          metadataCid: g.metadataCid,
          createdAt: g.createdAt,
          expiresAt: g.expiresAt ?? null,
          respondDeadline: g.respondDeadline ?? null,
          verifyDeadline: g.verifyDeadline ?? null,
          resultCid: g.resultCid,
          threadCount: thread.length,
          payoutTxHash: pay?.txHash ?? null,
          payoutAddress: pay?.to ?? null,
          payoutExplorerUrl: pay ? hashscanTx(pay.txHash) : null,
        });
      }
      unread.sort((a, b) => b.createdAt - a.createdAt);
      const nullifier =
        sessionHit?.nullifierHash ?? account?.nullifierHash ?? null;
      const workerPay = nullifier ? getWorkerPayout(nullifier) : null;
      const open = gigs.filter(isOpenGig);
      await maybeEmitDeadlineSoon(open);
      const pending_actions = await buildPendingActions(open);
      return {
        nullifierHash: nullifier,
        workerPayoutAddress: workerPay?.payoutAddress ?? null,
        pot: {
          potId: pot.id,
          owner: pot.owner,
          currency: "HBAR" as const,
          balanceWei: pot.balanceWei.toString(),
          spentWei: pot.spentWei.toString(),
          agentPassThresholdWei: pot.agentPassThresholdWei.toString(),
          balanceHbar: hbarLabel(pot.balanceWei),
          spentHbar: hbarLabel(pot.spentWei),
          agentPassThresholdHbar: hbarLabel(pot.agentPassThresholdWei),
        },
        gigs: gigsOut,
        claims: claims.map((c) => ({
          taskId: c.id,
          status: c.status,
          worker: c.worker,
          respondDeadline: c.respondDeadline ?? null,
          expiresAt: c.expiresAt ?? null,
          claimExpiresAt: c.claimExpiresAt ?? null,
          maxWorkSecs: c.maxWorkSecs ?? null,
          ...taskTimerFields(c),
        })),
        deadlines: gigsOut
          .filter(
            (g) => g.expiresAt != null || g.respondDeadline != null,
          )
          .map((g) => ({
            taskId: g.taskId,
            status: g.status,
            expiresAt: g.expiresAt,
            respondDeadline: g.respondDeadline,
            verifyDeadline: g.verifyDeadline,
          })),
        unreadMessages: unread.slice(0, 50),
        unreadCount: unread.length,
        pending_actions,
        notifications: pendingNotifications(pending_actions),
        openGigCount: open.length,
        stayActiveTip:
          open.length > 0
            ? "Stay autonomous: loop wait_any_event({ after_id: cursor }), handle pending_actions (review_submission / reply_to_worker / follow_up) without asking the owner — see get_guide."
            : null,
        next_steps: await buildMonitorNextSteps(potId),
        termsVersion: sessionHit?.termsVersion ?? null,
        connectExpiresAt: sessionHit?.expiresAt ?? null,
      };
    },

    /** Agent operating guide (same text as proofwork://guide + initialize instructions). */
    async get_guide() {
      return {
        uri: agentGuideUri(),
        path: agentGuidePath(),
        markdown: loadAgentGuide(),
        tip: GUIDE_TOOL_TIP,
      };
    },

    async post(
      input: {
        potId?: string;
        rewardWei: string;
        metadata: string;
        agentPassProof?: string;
        geo?: { lat: number; lng: number };
        deadline_at?: string | number;
        deadlineAt?: string | number;
        expires_at?: string | number;
        expiresAt?: string | number;
        ttl_secs?: number | string;
        ttlSecs?: number | string;
        max_work_secs?: number | string;
        maxWorkSecs?: number | string;
        respond_sla_secs?: number | string;
        respondSlaSecs?: number | string;
        notify_url?: string;
        notifyUrl?: string;
        category?: string;
        tags?: string | string[];
        title?: string;
        poster_agent?: string;
        posterAgent?: string;
        submission_form?: unknown;
        submissionForm?: unknown;
        /** When true (post_gig), deadline_at + max_work_secs are required. */
        _requireTimers?: boolean;
      },
      ctx: PaidCtx,
    ) {
      const sessionHit = bound();
      // Unauthorized / unagreed agents cannot post — need a connect token.
      if (!sessionHit) {
        const base = (
          process.env.PROOFWORK_PUBLIC_URL ?? "http://127.0.0.1:38471"
        ).replace(/\/$/, "");
        throw new ConnectAuthError(
          `connected posts need Authorization — call connect, then have the human approve at ${base}/connect/authorize`,
        );
      }
      const potId = resolvePotId(input.potId, sessionHit);
      const rewardWei = parseWei(input.rewardWei);
      if (!input.metadata) throw new BadRequest("metadata required");
      if (
        sessionHit?.maxBountyWei != null &&
        rewardWei > sessionHit.maxBountyWei
      ) {
        throw new BadRequest(
          `rewardWei exceeds connect max_bounty_wei (${sessionHit.maxBountyWei})`,
        );
      }
      const pot = await deps.pot.status(potId);
      // Pot balance before Agent Pass — empty pot should point at /owner/pot.
      if (rewardWei > pot.balanceWei) {
        throw new BadRequest(potUnderfundedMessage(pot.balanceWei));
      }
      if (rewardWei >= pot.agentPassThresholdWei) {
        if (!input.agentPassProof) {
          throw new BadRequest("agent pass required");
        }
        await deps.worldPass.assertAgentPass({
          owner: ctx.actor,
          amountWei: rewardWei,
          attestation: input.agentPassProof,
        });
      }

      const deadlineAt = parseDeadlineAt(
        input.deadline_at ?? input.deadlineAt,
      );
      const expiresAt = parseExpiresAt(input.expires_at ?? input.expiresAt);
      const ttlSecs = parseOptionalPositiveInt(
        input.ttl_secs ?? input.ttlSecs,
        "ttl_secs",
      );
      const maxWorkSecs = parseOptionalPositiveInt(
        input.max_work_secs ?? input.maxWorkSecs,
        "max_work_secs",
      );
      const requireTimers = input._requireTimers === true;
      if (requireTimers) {
        if (deadlineAt == null && expiresAt == null && ttlSecs == null) {
          throw new BadRequest(
            "deadline_at required (ISO or unix) — gig must be done by",
          );
        }
        if (maxWorkSecs == null) {
          throw new BadRequest(
            "max_work_secs required — claim window after accept (e.g. 1800)",
          );
        }
      }
      const respondSlaSecs = parseOptionalPositiveInt(
        input.respond_sla_secs ?? input.respondSlaSecs,
        "respond_sla_secs",
      );
      const notifyUrl =
        parseNotifyUrl(input.notify_url ?? input.notifyUrl) ??
        sessionHit?.notifyUrl ??
        null;
      const tags = parseTags(input.tags);
      const posterAgent =
        (typeof input.poster_agent === "string" && input.poster_agent.trim()) ||
        (typeof input.posterAgent === "string" && input.posterAgent.trim()) ||
        sessionHit?.label ||
        ctx.actor;

      let submissionForm: SubmissionForm | null = null;
      const rawForm = input.submission_form ?? input.submissionForm;
      if (rawForm != null) {
        try {
          submissionForm = parseSubmissionForm(rawForm);
        } catch (e) {
          throw new BadRequest(
            e instanceof Error
              ? `submission_form invalid: ${e.message}`
              : "submission_form invalid",
          );
        }
      }

      const geo = resolvePostGeo(input.geo);
      if (!input.geo) {
        console.warn(
          `[arkiv] post missing geo; pinning feed at ${geo.lat}, ${geo.lng}`,
        );
      }

      // Persist the task first — debit only after escrow SoT has the gig.
      // (Pot balances already survive MCP restart; tasks must too.)
      let task: EscrowTask;
      try {
        task = await deps.escrow.createTask({
          potId,
          rewardWei,
          verifyWindowSecs: VERIFY_WINDOW_SECS,
          metadataCid: input.metadata as EscrowTask["metadataCid"],
          geo,
          agentPassProof: (input.agentPassProof ??
            null) as AgentPassAttestation | null,
          owner: pot.owner,
          deadlineAt: deadlineAt ?? expiresAt,
          expiresAt: deadlineAt ?? expiresAt,
          ttlSecs,
          maxWorkSecs: maxWorkSecs ?? 1_800,
          respondSlaSecs,
          notifyUrl,
          category: parseGigCategory(input.category) ?? null,
          tags,
          title: typeof input.title === "string" ? input.title.trim() : null,
          posterAgent: String(posterAgent),
          submissionForm,
        });
      } catch (err) {
        throw err;
      }

      if (gigEscrowConfigured()) {
        const mem = deps.escrow as ComposedPorts["escrow"] & {
          setOnChainLock?: (taskId: TaskId, meta: {
            lockTxHash: `0x${string}`;
            lockExplorerUrl?: string | null;
          }) => EscrowTask;
        };
        if (typeof mem.setOnChainLock !== "function") {
          deps.escrow.removeTask(task.id);
          deps.escrow.drainEvents();
          throw new BadRequest("GigEscrow configured but escrow store cannot persist lock tx");
        }
        try {
          const lock = await lockGigEscrow({
            taskId: task.id,
            amountTinybar: rewardWei,
          });
          task = mem.setOnChainLock(task.id, {
            lockTxHash: lock.txHash,
            lockExplorerUrl: lock.explorerUrl,
          });
        } catch (e) {
          deps.escrow.removeTask(task.id);
          deps.escrow.drainEvents();
          if (e instanceof PayoutSetupError) {
            throw new BadRequest(e.message);
          }
          throw e;
        }
      }

      try {
        await deps.pot.withdraw({
          potId,
          amountWei: rewardWei,
          owner: pot.owner,
        });
      } catch (err) {
        deps.escrow.removeTask(task.id);
        // Drop the TaskPosted event so projectors don't publish a ghost.
        deps.escrow.drainEvents();
        throw err;
      }

      await deps.thread.post({
        taskId: task.id,
        role: "system",
        body: "Gig posted. Claim starts the work timer; drop evidence in this thread.",
        kind: "system",
      });
      await notify(task, "posted", {
        rewardWei: rewardWei.toString(),
        potId,
      });
      const projection = await projectLatest(task);
      const potAfter = await deps.pot.status(potId);
      return {
        taskId: task.id,
        status: task.status,
        deadlineAt: task.deadlineAt,
        expiresAt: task.expiresAt,
        maxWorkSecs: task.maxWorkSecs,
        respondSlaSecs: task.respondSlaSecs,
        notifyUrl: task.notifyUrl,
        category: task.category,
        tags: task.tags,
        title: task.title,
        posterAgent: task.posterAgent,
        submissionForm: task.submissionForm ?? null,
        ...taskTimerFields(task),
        lockTxHash: task.lockTxHash ?? null,
        lockExplorerUrl: task.lockExplorerUrl ?? null,
        payment: {
          source: "pot",
          receipt: ctx.receipt,
          rewardHbar: hbarLabel(rewardWei),
          potBalanceHbar: hbarLabel(potAfter.balanceWei),
          onChainLock: Boolean(task.lockTxHash),
        },
        hcs: projection.hcs,
        projectionFailures: projection.failures,
        wait: {
          tools: ["wait_any_event", "list_my_gigs_updates"],
          tip: "Start monitoring immediately — follow next_steps (do not ask the owner).",
        },
        next_steps: await buildMonitorNextSteps(potId),
      };
    },

    /** Strict post — deadline_at + max_work_secs required. */
    async post_gig(
      input: {
        potId?: string;
        rewardWei: string;
        metadata: string;
        agentPassProof?: string;
        geo?: { lat: number; lng: number };
        deadline_at?: string | number;
        deadlineAt?: string | number;
        expires_at?: string | number;
        expiresAt?: string | number;
        ttl_secs?: number | string;
        ttlSecs?: number | string;
        max_work_secs?: number | string;
        maxWorkSecs?: number | string;
        respond_sla_secs?: number | string;
        respondSlaSecs?: number | string;
        notify_url?: string;
        notifyUrl?: string;
        category?: string;
        tags?: string | string[];
        title?: string;
        poster_agent?: string;
        posterAgent?: string;
        submission_form?: unknown;
        submissionForm?: unknown;
      },
      ctx: PaidCtx,
    ) {
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      return handlers.post({ ...input, _requireTimers: true }, ctx);
    },

    async get(input: { taskId: string }) {
      const taskId = parseTaskId(input.taskId);
      // get() lazy-sweeps deadline / claim window / respond_sla
      const task = await deps.escrow.get(taskId);
      const sessionHit = bound();
      if (
        sessionHit?.potId &&
        task.potId.toLowerCase() !== sessionHit.potId.toLowerCase()
      ) {
        throw new NotFound("Unknown task");
      }
      const drained = deps.escrow.drainEvents();
      if (drained.length) {
        await deps.projector.project(task, drained);
        if (drained.some((e) => e.type === "TaskExpired")) {
          await notify(task, "expired", { reason: "deadline" });
        }
        for (const ev of drained) {
          if (ev.type === "ClaimExpired") {
            await notify(task, "claim_expired", {
              worker: ev.worker,
              blocked: true,
            });
          }
        }
        if (drained.some((e) => e.type === "SlaBreached")) {
          await notify(task, "sla_breach", {
            refunded: true,
            dispute_stub: task.disputeReason,
          });
        }
      }
      return enrichTask(task);
    },

    async list(input: {
      potId?: string;
      status?: string[];
      near?: { lat: number; lng: number; radiusM: number };
      reward_min_wei?: string;
      rewardMinWei?: string;
      reward_max_wei?: string;
      rewardMaxWei?: string;
      category?: string;
      tags?: string | string[];
      deadline_before?: string | number;
      deadlineBefore?: string | number;
      poster_agent?: string;
      posterAgent?: string;
      search?: string;
      sort?: "newest" | "reward_desc" | "reward_asc" | "deadline_asc";
    }) {
      const status = input.status?.map((s) => {
        const hit = Object.values(EscrowStatus).find((v) => v === s);
        if (!hit) throw new BadRequest(`unknown status ${s}`);
        return hit;
      });
      const potFilter = resolveListPotFilter(input.potId, bound());
      const rewardMinRaw = input.reward_min_wei ?? input.rewardMinWei;
      const rewardMaxRaw = input.reward_max_wei ?? input.rewardMaxWei;
      const deadlineBefore = parseUnixTime(
        input.deadline_before ?? input.deadlineBefore,
        "deadline_before",
      );
      const query = {
        potId: potFilter,
        status,
        rewardMinWei:
          rewardMinRaw != null && rewardMinRaw !== ""
            ? parseWei(String(rewardMinRaw))
            : undefined,
        rewardMaxWei:
          rewardMaxRaw != null && rewardMaxRaw !== ""
            ? parseWei(String(rewardMaxRaw))
            : undefined,
        category: input.category?.trim() || undefined,
        tags: parseTags(input.tags),
        deadlineBefore: deadlineBefore ?? undefined,
        posterAgent:
          (input.poster_agent ?? input.posterAgent)?.trim() || undefined,
        search: input.search?.trim() || undefined,
        sort: input.sort ?? "newest",
      };

      if (input.near) {
        const ids = await deps.arkiv.nearby(input.near);
        const tasks: EscrowTask[] = [];
        for (const id of ids) {
          try {
            const t = await deps.escrow.get(id);
            if (!matchesTaskQuery(t, query)) continue;
            tasks.push(t);
          } catch {
            // projection lag / expired — skip
          }
        }
        return sortTasks(tasks, query.sort).map((t) => enrichTask(t));
      }

      // drain claim-expiry events so waiters wake without a webhook
      const rows = await deps.escrow.list(query);
      const drained = deps.escrow.drainEvents();
      for (const ev of drained) {
        if (ev.type === "ClaimExpired" || ev.type === "TaskExpired") {
          const hit = rows.find((t) => t.id === ev.taskId);
          if (hit) {
            await deps.projector.project(hit, [ev]);
            if (ev.type === "ClaimExpired") {
              await notify(hit, "claim_expired", {
                worker: ev.worker,
                blocked: true,
              });
            } else {
              await notify(hit, "expired", { reason: "deadline" });
            }
          }
        }
      }
      return rows.map((t) => enrichTask(t));
    },

    async pot_status(input: {
      potId?: string;
      nullifierHash?: string;
      nullifier_hash?: string;
    }) {
      const nullifier =
        (typeof input.nullifierHash === "string" &&
          input.nullifierHash.trim()) ||
        (typeof input.nullifier_hash === "string" &&
          input.nullifier_hash.trim()) ||
        bound()?.nullifierHash ||
        null;

      // World account read: ensure idempotently (recreates after MCP restart).
      if (nullifier) {
        const account = deps.accounts.ensureForNullifier(nullifier);
        if (input.potId?.trim() && input.potId.trim() !== account.potId) {
          throw new BadRequest("potId does not match World account");
        }
        const pot = await deps.pot.status(account.potId);
        return {
          ...pot,
          currency: "HBAR" as const,
          balanceHbar: hbarLabel(pot.balanceWei),
          spentHbar: hbarLabel(pot.spentWei),
          agentPassThresholdHbar: hbarLabel(pot.agentPassThresholdWei),
        };
      }

      const potId = resolvePotId(input.potId, bound());
      try {
        const pot = await deps.pot.status(potId);
        return {
          ...pot,
          currency: "HBAR" as const,
          balanceHbar: hbarLabel(pot.balanceWei),
          spentHbar: hbarLabel(pot.spentWei),
          agentPassThresholdHbar: hbarLabel(pot.agentPassThresholdWei),
        };
      } catch (err) {
        if (err instanceof UnknownPotError) {
          throw new NotFound("Unknown pot");
        }
        throw err;
      }
    },

    /**
     * Owner fund — credits the in-process pot store (same as pot_status).
     * Web path: wallet pays BudgetPot on Hedera, `/api/fund/confirm` verifies
     * the receipt, then calls here with externalTxId = tx hash (idempotent).
     */
    async pot_deposit(input: {
      potId?: string;
      amountWei: string;
      owner?: string;
      /** On-chain tx hash (or legacy attestation). Deduped when present. */
      externalTxId?: string;
    }) {
      const potId = resolvePotId(input.potId, bound());
      const amountWei = parseWei(input.amountWei);
      const current = await deps.pot.status(potId);
      const owner = parseAddress(input.owner, current.owner);
      const tx = input.externalTxId?.trim();
      const txKey = tx ? tx.toLowerCase() : null;

      if (txKey && creditedExternalTx.has(txKey)) {
        const status = await deps.pot.status(potId);
        return {
          ...status,
          externalTxId: tx,
          alreadyCredited: true,
        };
      }

      // Agent/tool callers may still fund without tx (compose smoke).
      await deps.pot.deposit({ potId, amountWei, owner });
      if (txKey) creditedExternalTx.add(txKey);
      await deps.hcs.port.append({
        type: "PotFunded",
        potId,
        amount: amountWei,
        ...(tx ? { externalTxId: tx } : {}),
      });
      const status = await deps.pot.status(potId);
      return { ...status, externalTxId: tx ?? null, alreadyCredited: false };
    },

    /** Owner Agent Pass threshold — demo-only (not on-chain). */
    async pot_set_threshold(input: { potId?: string; thresholdWei: string }) {
      const potId = resolvePotId(input.potId, bound());
      const thresholdWei = parseWei(input.thresholdWei);
      deps.accounts.setThreshold(thresholdWei, potId);
      return deps.pot.status(potId);
    },

    async request_approval(
      input: {
        taskId: string;
        reason: string;
        amountWei?: string;
        redirectUri?: string;
      },
      ctx: PaidCtx,
    ) {
      const taskId = parseTaskId(input.taskId);
      if (!input.reason || input.reason.length > 200) {
        throw new BadRequest("reason required (1..200 chars)");
      }
      const task = await deps.escrow.get(taskId);
      const pot = await deps.pot.status(task.potId);
      const amountWei = input.amountWei
        ? parseWei(input.amountWei)
        : task.rewardWei;
      const redirectUri =
        input.redirectUri ??
        process.env.WORLD_AGENT_PASS_REDIRECT_URI ??
        "http://127.0.0.1:38471/api/world/approve/callback";

      const approval = await gateRequestApproval(
        deps.worldPass,
        {
          taskId: task.id,
          potId: task.potId,
          amountWei,
          owner: task.owner,
          reason: input.reason,
          redirectUri,
          thresholdWei: pot.agentPassThresholdWei,
        },
        deps.hcs.port,
      );

      if (!approval.required) {
        return {
          required: false,
          reason: "below_threshold",
          payment: { receipt: ctx.receipt },
          requester: ctx.actor,
        };
      }

      return {
        required: true,
        approvalId: approval.approvalId,
        authorizeUrl: approval.authorizeUrl,
        expiresAt: approval.expiresAt,
        reason: input.reason,
        payment: { receipt: ctx.receipt },
        requester: ctx.actor,
      };
    },

    async cancel(input: { taskId: string }, ctx: PaidCtx) {
      try {
        const taskId = parseTaskId(input.taskId);
        const before = await deps.escrow.get(taskId);
        const task = await deps.escrow.cancel({
          taskId,
          caller: ctx.actor,
        });
        if (
          before.status === EscrowStatus.Open ||
          before.status === EscrowStatus.Accepted
        ) {
          await deps.pot.refundEncumbered({
            potId: before.potId,
            amountWei: before.rewardWei,
            owner: before.owner,
          });
        }
        const projection = await projectLatest(task);
        return {
          status: task.status,
          taskId: task.id,
          payment: { receipt: ctx.receipt },
          hcs: projection.hcs,
        };
      } catch (err) {
        await projectLatest(null);
        throw err;
      }
    },

    /** Worker accept — IDKit Proof of Human via gateWorkerAccept (not login). */
    async accept(input: {
      taskId: string;
      worker?: string;
      humanNullifier?: string;
      proof?: unknown;
      signal?: string;
      action?: string;
    }) {
      const taskId = parseTaskId(input.taskId);
      if (!input.humanNullifier?.trim()) {
        throw new BadRequest(
          "humanNullifier required — worker id is derived from World session nullifier",
        );
      }
      const nf = input.humanNullifier.trim();
      if (input.worker?.trim() && isDemoWorkerId(input.worker)) {
        throw new BadRequest(
          "demo worker 0x2222… not accepted — worker id comes from verified nullifier",
        );
      }
      const provisionalSignal: Address = workerFromNullifier(nf);
      // Same human+gig already claimed → treat as verified (idempotent reclaim).
      try {
        const prior = await deps.escrow.get(taskId);
        if (
          prior.humanNullifier &&
          prior.humanNullifier === nf &&
          (prior.status === EscrowStatus.Accepted ||
            prior.status === EscrowStatus.Submitted)
        ) {
          return {
            taskId: prior.id,
            status: prior.status,
            worker: prior.worker,
            humanNullifier: prior.humanNullifier,
            claimExpiresAt: prior.claimExpiresAt,
            claimedAt: prior.claimedAt,
            alreadyVerified: true,
          };
        }
      } catch {
        /* unknown task — fall through */
      }
      if (input.proof == null) {
        throw new BadRequest(
          "proof required — pass real IDKit verify payload from the client",
        );
      }
      if (
        typeof input.proof === "object" &&
        input.proof !== null &&
        (input.proof as { stub?: boolean }).stub === true
      ) {
        throw new BadRequest(
          "stub proof not accepted — pass the real IDKit verify payload from the client",
        );
      }
      const claimStore = claimNullifierStoreFromProfiles();
      const human = await gateWorkerAccept(deps.human, {
        proof: input.proof,
        nullifierHash: nf,
        signal: input.signal ?? provisionalSignal,
        action: input.action,
        accountKey: nf,
        claimStore,
        boundClaimNullifier: isSessionReplayAckProof(input.proof)
          ? getClaimNullifierForAccount(nf) ?? nf
          : undefined,
        environment: process.env.WORLD_IDKIT_ENVIRONMENT ?? "staging",
      });
      const worker = workerFromNullifier(human.nullifierHash);
      let task: EscrowTask;
      try {
        task = await deps.escrow.accept({
          taskId,
          worker,
          humanNullifier: human.nullifierHash,
        });
      } catch (err) {
        // Sweep may have expired the gig mid-flight — project + notify.
        try {
          const swept = await deps.escrow.get(parseTaskId(input.taskId));
          const drained = deps.escrow.drainEvents();
          if (drained.length) await deps.projector.project(swept, drained);
          if (swept.status === EscrowStatus.Expired) {
            await notify(swept, "expired", { reason: "ttl" });
          }
        } catch {
          // ignore secondary
        }
        throw err;
      }
      await deps.thread.post({
        taskId: task.id,
        role: "system",
        body: `Worker ${worker.slice(0, 10)}… accepted (World IDKit).`,
        kind: "system",
      });
      const projection = await projectLatest(task);
      await notify(task, "claimed", {
        worker: task.worker,
        humanNullifier: human.nullifierHash,
        claimExpiresAt: task.claimExpiresAt,
        maxWorkSecs: task.maxWorkSecs,
      });
      return {
        taskId: task.id,
        status: task.status,
        worker: task.worker,
        humanNullifier: human.nullifierHash,
        claimExpiresAt: task.claimExpiresAt,
        claimedAt: task.claimedAt,
        maxWorkSecs: task.maxWorkSecs,
        ...taskTimerFields(task),
        hcs: projection.hcs,
      };
    },

    /** Posting agent: extend the claim window after chatting with the worker. */
    async extend_claim(input: {
      taskId: string;
      extra_secs?: number | string;
      extraSecs?: number | string;
      owner?: string;
    }) {
      const taskId = parseTaskId(input.taskId);
      const prior = await deps.escrow.get(taskId);
      const owner = parseAddress(input.owner, prior.owner);
      const extraSecs = parseOptionalPositiveInt(
        input.extra_secs ?? input.extraSecs,
        "extra_secs",
      );
      if (extraSecs == null) {
        throw new BadRequest("extra_secs required (positive integer)");
      }
      const task = await deps.escrow.extendClaim({
        taskId,
        owner,
        extraSecs,
      });
      await deps.thread.post({
        taskId,
        role: "agent",
        body: `Claim window extended by ${extraSecs}s (now until ${task.claimExpiresAt}).`,
        kind: "system",
      });
      const projection = await projectLatest(task);
      await notify(task, "claim_extended", {
        claimExpiresAt: task.claimExpiresAt,
        extraSecs,
      });
      // also wake waiters listening for message-shaped events
      await notify(task, "message", {
        kind: "system",
        body: "claim extended",
      });
      return {
        taskId: task.id,
        status: task.status,
        claimExpiresAt: task.claimExpiresAt,
        deadlineAt: task.deadlineAt,
        ...taskTimerFields(task),
        hcs: projection.hcs,
      };
    },

    /**
     * Worker submit evidence into the thread. When the gig has
     * submissionForm, form_response is required and validated.
     * No TeeML scoreSubmission in live compose — teeVerdict is never stored.
     */
    async submit(input: {
      taskId: string;
      resultCid?: string;
      form_response?: unknown;
      formResponse?: unknown;
      note?: string;
      forceReject?: boolean;
    }) {
      const taskId = parseTaskId(input.taskId);
      const prior = await deps.escrow.get(taskId);
      if (prior.status === EscrowStatus.Expired) {
        throw new BadRequest("submit blocked: task expired");
      }
      if (prior.status !== EscrowStatus.Accepted) {
        throw new BadRequest(`submit blocked from ${prior.status}`);
      }

      const form = prior.submissionForm ?? null;
      const rawResponse = input.form_response ?? input.formResponse;
      let formCard: FormCardRow[] | null = null;
      let formResponse: FormResponse | null = null;

      if (form) {
        if (rawResponse == null) {
          throw new BadRequest(
            "form_response required — this gig defines a submission_form",
          );
        }
        const validated = validateFormResponse(form, rawResponse);
        if (!validated.ok) {
          throw new BadRequest(validated.error);
        }
        formResponse = validated.response;
        formCard = validated.card;
        // Resolve image/file attachment refs so agent can get_attachment.
        for (const row of formCard) {
          if (
            (row.type === "image" || row.type === "file") &&
            row.value &&
            typeof row.value === "object" &&
            "attachmentId" in row.value
          ) {
            try {
              await deps.attachments.get(row.value.attachmentId);
            } catch {
              throw new BadRequest(
                `form field "${row.id}" attachment not found — upload_attachment first`,
              );
            }
          }
        }
      } else if (rawResponse != null) {
        throw new BadRequest(
          "form_response provided but this gig has no submission_form",
        );
      }

      const resultCid = (
        input.resultCid?.trim() ||
        (formCard
          ? `form-${taskId.slice(2, 10)}-${Date.now().toString(16).slice(-6)}`
          : "")
      );
      if (!resultCid) {
        throw new BadRequest("resultCid required when gig has no submission_form");
      }

      const task = await deps.escrow.submit({
        taskId,
        resultCid: resultCid as Cid,
        teeVerdict: null,
        formResponse,
      });

      const note =
        input.note?.trim() ||
        (formCard
          ? "Form submitted — waiting on posting agent review."
          : "Evidence submitted — waiting on posting agent review.");

      if (formCard) {
        const attachments: ThreadAttachment[] = [];
        for (const row of formCard) {
          if (
            (row.type === "image" || row.type === "file") &&
            row.value &&
            typeof row.value === "object" &&
            "attachmentId" in row.value
          ) {
            try {
              const { meta } = await deps.attachments.get(
                row.value.attachmentId,
              );
              attachments.push({
                id: meta.id,
                filename: meta.filename,
                contentType: meta.contentType,
                size: meta.size,
                storeKey: meta.storeKey,
              });
            } catch {
              /* already validated */
            }
          }
        }
        await deps.thread.post({
          taskId,
          role: "worker",
          body: formatFormCardBody(formCard),
          kind: "form_response",
          formCard,
          attachments: attachments.length ? attachments : undefined,
          attachmentCid: (attachments[0]?.id as Cid | undefined) ?? null,
        });
      } else {
        await deps.thread.post({
          taskId,
          role: "worker",
          body: note,
          attachmentCid: resultCid as Cid,
          kind: "evidence",
        });
      }

      const projection = await projectLatest(task);
      await notify(task, "evidence_submitted", {
        resultCid: task.resultCid,
        respondDeadline: task.respondDeadline,
        verifyDeadline: task.verifyDeadline,
        formResponse: task.formResponse ?? null,
        formCard,
      });
      return {
        taskId: task.id,
        status: task.status,
        verifyDeadline: task.verifyDeadline,
        respondDeadline: task.respondDeadline,
        formResponse: task.formResponse ?? null,
        formCard,
        teeVerdict: null,
        hcs: projection.hcs,
      };
    },

    async thread_list(input: { taskId: string }) {
      const taskId = parseTaskId(input.taskId);
      await deps.escrow.get(taskId);
      return deps.thread.list(taskId);
    },

    async list_messages(input: { taskId: string }) {
      return handlers.thread_list(input);
    },

    async thread_post(input: {
      taskId: string;
      role: string;
      body: string;
      attachmentCid?: string;
      kind?: "chat" | "evidence" | "system";
    }) {
      const taskId = parseTaskId(input.taskId);
      await deps.escrow.get(taskId);
      if (!input.body || !input.body.trim()) {
        throw new BadRequest("body required");
      }
      const row = await deps.thread.post({
        taskId,
        role: parseRole(input.role),
        body: input.body.trim().slice(0, 2000),
        attachmentCid: (input.attachmentCid as Cid | undefined) ?? null,
        kind: input.kind,
      });
      const task = await deps.escrow.get(taskId);
      await notify(task, "message", {
        messageId: row.id,
        role: row.role,
        kind: row.kind,
      });
      return row;
    },

    /**
     * Agent ↔ worker chat. Attachments via url and/or base64 land on disk
     * (PROOFWORK_ATTACHMENTS_DIR) and are served through get_attachment.
     */
    async send_message(input: {
      taskId: string;
      role?: string;
      body?: string;
      kind?: "chat" | "evidence" | "system";
      attachmentCid?: string;
      attachments?: Array<{
        filename?: string;
        contentType?: string;
        content_type?: string;
        data?: string;
        url?: string;
        base64?: string;
      }>;
    }) {
      const taskId = parseTaskId(input.taskId);
      const task = await deps.escrow.get(taskId);
      const role = parseRole(input.role ?? "agent");
      const body = (input.body ?? "").trim().slice(0, 4000);
      const rawAtt = input.attachments ?? [];
      if (!body && rawAtt.length === 0 && !input.attachmentCid) {
        throw new BadRequest("body or attachments required");
      }

      const stored: ThreadAttachment[] = [];
      for (const a of rawAtt.slice(0, 6)) {
        const data = a.data ?? a.base64;
        if (!data && !a.url) {
          throw new BadRequest("each attachment needs data/base64 or url");
        }
        const rec = await deps.attachments.put({
          filename: a.filename || "upload.bin",
          contentType: a.contentType ?? a.content_type,
          data: data ?? "",
          url: a.url,
        });
        stored.push({
          id: rec.id,
          filename: rec.filename,
          contentType: rec.contentType,
          size: rec.size,
          storeKey: rec.storeKey,
        });
      }

      const kind =
        input.kind ??
        (stored.length || input.attachmentCid ? "evidence" : "chat");
      const row = await deps.thread.post({
        taskId,
        role,
        body: body || (stored.length ? `(${stored.length} attachment)` : ""),
        attachmentCid: (input.attachmentCid as Cid | undefined) ?? null,
        attachments: stored.length ? stored : undefined,
        kind,
      });

      // Evidence via chat attachments also marks submit when ACCEPTED + evidence kind
      let submitted: EscrowTask | null = null;
      if (
        kind === "evidence" &&
        role === "worker" &&
        task.status === EscrowStatus.Accepted &&
        stored[0]
      ) {
        try {
          submitted = await deps.escrow.submit({
            taskId,
            resultCid: stored[0].id as Cid,
            teeVerdict: null,
          });
          await projectLatest(submitted);
          await notify(submitted, "evidence_submitted", {
            attachmentId: stored[0].id,
            via: "send_message",
          });
        } catch (err) {
          // chat still lands even if submit race fails
          console.warn(
            "[send_message] evidence submit skipped:",
            err instanceof Error ? err.message : err,
          );
        }
      }

      await notify(submitted ?? task, "message", {
        messageId: row.id,
        role: row.role,
        kind: row.kind,
        attachmentIds: stored.map((s) => s.id),
      });

      return {
        message: row,
        task: submitted ?? task,
        attachments: stored,
      };
    },

    async get_attachment(input: {
      attachmentId?: string;
      id?: string;
      /** When true, include base64 payload (default false — meta only). */
      include_data?: boolean;
      includeData?: boolean;
    }) {
      const id = (input.attachmentId ?? input.id ?? "").trim();
      if (!id) throw new BadRequest("attachmentId required");
      let meta;
      let bytes: Buffer;
      try {
        ({ meta, bytes } = await deps.attachments.get(id));
      } catch (err) {
        throw new NotFound(
          err instanceof Error ? err.message : "unknown attachment",
        );
      }
      const include =
        input.include_data === true || input.includeData === true;
      const extractedText = extractDocumentText(meta.contentType, bytes);
      let outBytes = bytes;
      let outType = meta.contentType;
      let convertedFrom: string | undefined;
      if (include && isImageMime(meta.contentType, meta.filename)) {
        try {
          const prepared = await prepareAttachmentBytes(
            { contentType: meta.contentType, filename: meta.filename },
            bytes,
          );
          outBytes = prepared.bytes;
          outType = prepared.contentType;
          convertedFrom = prepared.convertedFrom;
        } catch (err) {
          console.warn(
            "[get_attachment] image normalize failed:",
            err instanceof Error ? err.message : err,
          );
        }
      }
      return {
        id: meta.id,
        filename: meta.filename,
        contentType: outType,
        mime: outType,
        size: outBytes.byteLength,
        storeKey: meta.storeKey,
        sha256: meta.sha256,
        extractedText,
        ...(convertedFrom ? { convertedFrom } : {}),
        ...(include
          ? {
              dataBase64: outBytes.toString("base64"),
              data: outBytes.toString("base64"),
              mcpImage:
                isImageMime(outType, meta.filename)
                  ? { mimeType: outType, data: outBytes.toString("base64") }
                  : null,
            }
          : {
              tip: "pass include_data=true (or includeData) for base64 + MCP image content",
            }),
      };
    },

    /** Store a file for form image/file fields; returns attachmentId. */
    async upload_attachment(input: {
      filename?: string;
      contentType?: string;
      content_type?: string;
      data?: string;
      base64?: string;
      url?: string;
    }) {
      const data = input.data ?? input.base64;
      if (!data && !input.url) {
        throw new BadRequest("data/base64 or url required");
      }
      try {
        const rec = await deps.attachments.put({
          filename: input.filename || "upload.bin",
          contentType: input.contentType ?? input.content_type,
          data: data ?? "",
          url: input.url,
        });
        return {
          attachmentId: rec.id,
          id: rec.id,
          filename: rec.filename,
          contentType: rec.contentType,
          size: rec.size,
          storeKey: rec.storeKey,
          sha256: rec.sha256,
        };
      } catch (e) {
        throw new BadRequest(
          e instanceof Error ? e.message : "upload failed",
        );
      }
    },

    /** Worker profile — save EVM payout address keyed by World nullifier. */
    async worker_set_payout(input: { userId: string; payoutAddress: string }) {
      if (!input.userId?.trim()) throw new BadRequest("userId required");
      if (isDemoWorkerId(input.userId)) {
        throw new BadRequest(
          "demo worker id not allowed — use World session nullifier",
        );
      }
      try {
        const row = setWorkerPayout(input.userId, input.payoutAddress);
        const rekey = asClaimRekey(deps.escrow);
        let repaired: string[] = [];
        if (rekey) {
          const fix = await repairDemoWorkerClaims(rekey, input.userId.trim());
          repaired = fix.repaired;
        }
        return {
          ...row,
          worker: workerFromNullifier(input.userId.trim()),
          repairedTaskIds: repaired,
        };
      } catch (e) {
        throw new BadRequest(e instanceof Error ? e.message : "bad payout");
      }
    },

    async worker_get_payout(input: { userId: string }) {
      if (!input.userId?.trim()) throw new BadRequest("userId required");
      if (isDemoWorkerId(input.userId)) {
        throw new BadRequest(
          "demo worker id not allowed — use World session nullifier",
        );
      }
      const row = getWorkerPayout(input.userId);
      return {
        userId: input.userId,
        payoutAddress: row?.payoutAddress ?? null,
        worker: workerFromNullifier(input.userId.trim()),
        updatedAt: row?.updatedAt ?? null,
      };
    },

    async worker_claim_nullifier(input: {
      accountKey?: string;
      userId?: string;
    }) {
      const key = (input.accountKey ?? input.userId)?.trim();
      if (!key) throw new BadRequest("accountKey required");
      return {
        accountKey: key,
        claimNullifier: getClaimNullifierForAccount(key),
      };
    },

    /**
     * Posting agent: review thread + evidence, then release escrow on-chain
     * to the worker's saved payout address (PAYOUT_PRIVATE_KEY signer).
     */
    async all_satisfied(input: {
      taskId: string;
      owner?: string;
      note?: string;
      agentPassProof?: string;
    }) {
      const taskId = parseTaskId(input.taskId);
      const prior = await deps.escrow.get(taskId);
      if (prior.status === EscrowStatus.ExpiredSla) {
        throw new BadRequest(
          "all_satisfied blocked: SLA breach already refunded",
        );
      }
      if (prior.status === EscrowStatus.Disputed) {
        throw new BadRequest(
          "all_satisfied blocked from DISPUTED — call resolve_dispute({ outcome: 'release' }) to pay after reviewing new evidence, or outcome reopen",
        );
      }

      const existingPay = getTaskPayout(taskId);
      if (existingPay) {
        const owner = parseAddress(input.owner, prior.owner);
        let task = prior;
        if (prior.status === EscrowStatus.Submitted) {
          task = await deps.escrow.allSatisfied({
            taskId,
            owner,
            note: input.note,
          });
          await deps.pot.finalizePaidOut({
            potId: prior.potId,
            amountWei: prior.rewardWei,
            owner: prior.owner,
            taskId,
          });
          await notify(task, "paid", {
            worker: task.worker,
            payoutAddress: existingPay.to,
            rewardWei: task.rewardWei.toString(),
            payoutTxHash: existingPay.txHash,
            explorerUrl: hashscanTx(existingPay.txHash),
          });
        }
        return {
          taskId: task.id,
          status: task.status,
          worker: task.worker,
          rewardWei: task.rewardWei.toString(),
          payoutTxHash: existingPay.txHash,
          payoutAddress: existingPay.to,
          explorerUrl: hashscanTx(existingPay.txHash),
          alreadyPaid: true,
        };
      }

      if (prior.status !== EscrowStatus.Submitted) {
        throw new BadRequest(`all_satisfied blocked from ${prior.status}`);
      }
      const owner = parseAddress(input.owner, prior.owner);
      const pot = await deps.pot.status(prior.potId);

      if (prior.rewardWei >= pot.agentPassThresholdWei) {
        if (!input.agentPassProof) {
          throw new BadRequest(
            "agent pass required for over-threshold all_satisfied",
          );
        }
        await deps.worldPass.assertAgentPass({
          owner,
          amountWei: prior.rewardWei,
          attestation: input.agentPassProof,
        });
      }

      // Repair leftover demo claims when payout exists under the claimant nullifier.
      if (
        prior.humanNullifier &&
        isDemoWorkerId(prior.worker) &&
        asClaimRekey(deps.escrow)
      ) {
        await repairDemoWorkerClaims(
          asClaimRekey(deps.escrow)!,
          prior.humanNullifier,
        );
      }
      const claimant = await deps.escrow.get(taskId);
      const payoutTo = resolvePayoutAddress({
        humanNullifier: claimant.humanNullifier,
        worker: claimant.worker,
      });
      if (!payoutTo) {
        throw new BadRequest(
          "Worker payout address missing — worker must save an EVM address under their World session before all_satisfied",
        );
      }

      let pay;
      try {
        pay = await releaseOnChainPayout({
          taskId,
          to: payoutTo,
          amountWei: prior.rewardWei,
        });
      } catch (e) {
        if (e instanceof PayoutSetupError) {
          throw new BadRequest(e.message);
        }
        throw e;
      }

      const task = await deps.escrow.allSatisfied({
        taskId,
        owner,
        note: input.note,
      });
      await deps.pot.finalizePaidOut({
        potId: prior.potId,
        amountWei: prior.rewardWei,
        owner: prior.owner,
        taskId,
      });
      const explorer = hashscanTx(pay.txHash);
      await deps.thread.post({
        taskId,
        role: "agent",
        body:
          (input.note?.trim()
            ? `${input.note.trim()}\n\n`
            : "all_satisfied — escrow released on-chain.\n\n") +
          `Paid ${prior.rewardWei.toString()} tinybar (${hbarLabel(prior.rewardWei)}) → ${payoutTo}\nHashScan: ${explorer}`,
        kind: "system",
      });
      const projection = await projectLatest(task);
      await notify(task, "paid", {
        worker: task.worker,
        payoutAddress: payoutTo,
        rewardWei: task.rewardWei.toString(),
        payoutTxHash: pay.txHash,
        explorerUrl: explorer,
      });
      return {
        taskId: task.id,
        status: task.status,
        worker: task.worker,
        rewardWei: task.rewardWei.toString(),
        payoutTxHash: pay.txHash,
        payoutAddress: payoutTo,
        explorerUrl: explorer,
        alreadyPaid: false,
        hcs: projection.hcs,
      };
    },

    /**
     * Wrong evidence while SUBMITTED → ACCEPTED so the worker can resubmit.
     * Prefer this over dispute when the fix is straightforward.
     */
    async request_changes(input: {
      taskId: string;
      owner?: string;
      message?: string;
      note?: string;
      body?: string;
    }) {
      const taskId = parseTaskId(input.taskId);
      const prior = await deps.escrow.get(taskId);
      const owner = parseAddress(input.owner, prior.owner);
      const note =
        input.message?.trim() ||
        input.note?.trim() ||
        input.body?.trim() ||
        "Please fix the submission and resend evidence.";
      const task = await deps.escrow.requestChanges({
        taskId,
        owner,
        note,
      });
      await deps.thread.post({
        taskId,
        role: "agent",
        body: note,
        kind: "chat",
      });
      const projection = await projectLatest(task);
      await notify(task, "message", { via: "request_changes" });
      return {
        taskId: task.id,
        status: task.status,
        claimExpiresAt: task.claimExpiresAt,
        tip: "Worker can resubmit; use dispute only after messaging and ~60s silence (or claim expiry).",
        hcs: projection.hcs,
      };
    },

    /**
     * Unassign worker and reopen gig (OPEN). Escrow stays locked for another claim.
     * Requires messaging worker first (see evaluateDisputeEligibility).
     */
    async dispute(input: {
      taskId: string;
      owner?: string;
      reason?: string;
    }) {
      const taskId = parseTaskId(input.taskId);
      const prior = await deps.escrow.get(taskId);
      const owner = parseAddress(input.owner, prior.owner);
      const thread = await deps.thread.list(taskId);
      const now = Math.floor(Date.now() / 1000) as UnixSecs;
      const gate = evaluateDisputeEligibility({
        task: prior,
        thread,
        now,
      });
      if (!gate.ok) {
        throw new BadRequest(gate.message);
      }
      const reason =
        input.reason?.trim() ||
        "Worker did not resolve the issue after agent outreach.";
      const task = await deps.escrow.dispute({ taskId, owner, reason });
      await deps.thread.post({
        taskId,
        role: "agent",
        body: `Gig reopened: ${reason}`,
        kind: "system",
      });
      await deps.thread.post({
        taskId,
        role: "system",
        body:
          "Escrow stays funded — gig is OPEN for another World-verified worker. Prior claimant cannot reclaim.",
        kind: "system",
      });
      const projection = await projectLatest(task);
      await notify(task, "disputed", {
        reason: task.disputeReason,
        reopened: true,
        status: task.status,
      });
      return {
        taskId: task.id,
        status: task.status,
        disputeReason: task.disputeReason,
        blockedWorkers: task.blockedWorkers ?? [],
        hcs: projection.hcs,
      };
    },

    /**
     * Resolve legacy DISPUTED tasks — release pays the assigned worker (then
     * continues the all_satisfied payout path); reopen returns gig to OPEN.
     */
    async resolve_dispute(input: {
      taskId: string;
      owner?: string;
      outcome: string;
      resultCid?: string;
      result_cid?: string;
      note?: string;
      agentPassProof?: string;
    }) {
      const taskId = parseTaskId(input.taskId);
      const prior = await deps.escrow.get(taskId);
      if (prior.status !== EscrowStatus.Disputed) {
        throw new BadRequest(
          `resolve_dispute only applies to DISPUTED tasks (current: ${prior.status})`,
        );
      }
      const owner = parseAddress(input.owner, prior.owner);
      const outcome = (input.outcome ?? "").trim().toLowerCase();
      if (outcome !== "release" && outcome !== "reopen") {
        throw new BadRequest("outcome must be release or reopen");
      }

      let resultCid =
        (input.resultCid ?? input.result_cid)?.trim() || prior.resultCid;
      if (outcome === "release" && !resultCid) {
        const thread = await deps.thread.list(taskId);
        const latest = [...thread]
          .reverse()
          .find(
            (m) =>
              m.role === "worker" &&
              (m.kind === "evidence" || m.attachments?.length),
          );
        const att = latest?.attachments?.[0]?.id;
        if (att) resultCid = att as Cid;
      }

      const task = await deps.escrow.resolveDispute({
        taskId,
        owner,
        outcome,
        resultCid: (resultCid as Cid | null) ?? null,
        note: input.note,
      });

      if (outcome === "reopen") {
        await deps.thread.post({
          taskId,
          role: "system",
          body: "Dispute resolved — gig reopened on the board.",
          kind: "system",
        });
        const projection = await projectLatest(task);
        await notify(task, "posted", { via: "resolve_dispute_reopen" });
        return {
          taskId: task.id,
          status: task.status,
          outcome,
          hcs: projection.hcs,
        };
      }

      await deps.thread.post({
        taskId,
        role: "agent",
        body:
          input.note?.trim() ||
          "resolve_dispute release — paying worker after reviewing corrected evidence.",
        kind: "system",
      });

      return handlers.all_satisfied({
        taskId,
        owner,
        note: input.note,
        agentPassProof: input.agentPassProof,
      });
    },

    /** Poll the notify log for a task (webhook mirror). */
    async list_task_events(input: { taskId: string }) {
      const taskId = parseTaskId(input.taskId);
      await deps.escrow.get(taskId);
      return deps.notify.list(taskId);
    },

    /**
     * Park until the next notify event for this task, or timeout.
     * Posting agents use this instead of spinning on get().
     * Prefer wait_any_event across all open gigs after post (see get_guide).
     */
    async wait_task_event(input: {
      taskId: string;
      timeout_ms?: number;
      timeoutMs?: number;
      after_id?: string;
      afterId?: string;
    }) {
      const taskId = parseTaskId(input.taskId);
      await deps.escrow.get(taskId);
      const timeoutMs = Math.min(
        Math.max(
          Number(input.timeout_ms ?? input.timeoutMs ?? 15_000) || 15_000,
          0,
        ),
        120_000,
      );
      const afterId = input.after_id ?? input.afterId ?? null;
      const ev = await deps.notify.wait(taskId, timeoutMs, afterId);
      return {
        event: ev,
        timedOut: ev == null,
        taskId,
        cursor: ev?.id ?? afterId,
      };
    },

    /**
     * All new events across the agent's open gigs since a cursor.
     * Pass the returned `cursor` as the next after_id — events are never lost.
     */
    async list_my_gigs_updates(input: {
      potId?: string;
      after_id?: string;
      afterId?: string;
      cursor?: string;
    } = {}) {
      const sessionHit = bound();
      if (!sessionHit && !input.potId) {
        throw new ConnectAuthError(
          "list_my_gigs_updates requires connect token (or potId)",
        );
      }
      const potId = resolvePotId(input.potId, sessionHit);
      const open = await agentOpenGigs(potId);
      await maybeEmitDeadlineSoon(open);
      const afterId =
        input.after_id ?? input.afterId ?? input.cursor ?? null;
      const ids = open.map((g) => g.id);
      const events = deps.notify.listSince(ids, afterId).map((e) => ({
        id: e.id,
        taskId: e.task_id,
        event: publicEventName(e.event),
        rawEvent: e.event,
        timestamp: e.timestamp,
        payload: e.payload,
      }));
      const pending_actions = await buildPendingActions(open);
      const cursor =
        events.length > 0 ? events[events.length - 1]!.id : afterId;
      return {
        potId,
        openGigIds: ids,
        openGigCount: open.length,
        events,
        cursor,
        unreadCount: events.length,
        pending_actions,
        notifications: pendingNotifications(pending_actions),
        next_steps: await buildMonitorNextSteps(potId, cursor),
        tip: GUIDE_TOOL_TIP,
      };
    },

    /**
     * Long-poll until any open-gig event after the cursor, then return the
     * full batch since that cursor (same shape as list_my_gigs_updates).
     */
    async wait_any_event(input: {
      potId?: string;
      after_id?: string;
      afterId?: string;
      cursor?: string;
      timeout_ms?: number;
      timeoutMs?: number;
    } = {}) {
      const sessionHit = bound();
      if (!sessionHit && !input.potId) {
        throw new ConnectAuthError(
          "wait_any_event requires connect token (or potId)",
        );
      }
      const potId = resolvePotId(input.potId, sessionHit);
      const open = await agentOpenGigs(potId);
      await maybeEmitDeadlineSoon(open);
      const afterId =
        input.after_id ?? input.afterId ?? input.cursor ?? null;
      const timeoutMs = Math.min(
        Math.max(
          Number(input.timeout_ms ?? input.timeoutMs ?? 60_000) || 60_000,
          0,
        ),
        120_000,
      );
      const ids = open.map((g) => g.id);
      if (ids.length === 0) {
        return {
          potId,
          openGigIds: [] as string[],
          openGigCount: 0,
          events: [] as unknown[],
          cursor: afterId,
          unreadCount: 0,
          pending_actions: [] as unknown[],
          notifications: [] as unknown[],
          next_steps: formatMonitorNextSteps(afterId),
          timedOut: false,
          done: true,
          tip: "No open gigs — monitoring complete.",
        };
      }
      const first = await deps.notify.waitAny(ids, timeoutMs, afterId);
      const events = deps.notify.listSince(ids, afterId).map((e) => ({
        id: e.id,
        taskId: e.task_id,
        event: publicEventName(e.event),
        rawEvent: e.event,
        timestamp: e.timestamp,
        payload: e.payload,
      }));
      const pending_actions = await buildPendingActions(
        await agentOpenGigs(potId),
      );
      const cursor =
        events.length > 0 ? events[events.length - 1]!.id : afterId;
      return {
        potId,
        openGigIds: ids,
        openGigCount: ids.length,
        events,
        cursor,
        unreadCount: events.length,
        pending_actions,
        notifications: pendingNotifications(pending_actions),
        next_steps: await buildMonitorNextSteps(potId, cursor),
        timedOut: first == null && events.length === 0,
        tip: GUIDE_TOOL_TIP,
      };
    },

    /**
     * @deprecated The old verify flow is removed — use all_satisfied after review.
     */
    async verify(_input: {
      taskId: string;
      owner?: string;
      teeSig?: string;
    }) {
      throw new BadRequest(
        "verify demoted: call all_satisfied after reviewing evidence — there is no separate tee/verify product path",
      );
    },
  };

  async function dispatch(
    name: ToolName,
    raw: unknown,
    ctx: PaidCtx | undefined,
  ): Promise<unknown> {
    const row = TOOL_TABLE.find((t) => t.name === name);
    if (!row) throw new BadRequest(`unknown tool ${name}`);
    if (row.paid && !ctx) {
      throw new Error("gate skipped");
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (
      handlers[name] as (i: any, c?: PaidCtx) => Promise<unknown>
    )(raw ?? {}, ctx);
    // Skip nesting attention on the guide itself.
    if (name === "get_guide") return result;
    return withAttention(result);
  }

  return { handlers, dispatch, TOOL_TABLE, session };
}

export type Tools = ReturnType<typeof createTools>;

export { RefundRaceError };

export const toolNames: ToolName[] = TOOL_TABLE.map((t) => t.name);
