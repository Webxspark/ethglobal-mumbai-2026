import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  EVIDENCE_TYPES,
  EXAMPLE_SUBMISSION_FORM,
  GIG_CATEGORIES,
} from "@proofwork/shared";
import type { ComposedPorts } from "@proofwork/shared/compose";
import { z } from "zod";
import {
  BadRequest,
  NotFound,
  RefundRaceError,
  TOOL_TABLE,
  type ToolName,
  type Tools,
} from "./tools.js";
import { invokeTool, jsonText, PaymentRequired } from "./invoke.js";
import {
  agentGuideUri,
  GUIDE_TOOL_TIP,
  loadAgentGuide,
} from "./agent-guide.js";
import {
  monitorResourceText,
  PROOFWORK_MONITOR_URI,
} from "./monitor-hints.js";

export { BadRequest } from "./tools.js";

const payHint =
  "X-PAYMENT value for paid tools (x402 settlement token from your wallet / client).";

const gigCategoryHint = `Gig type enum: ${GIG_CATEGORIES.join(" | ")}. Evidence kinds workers may return: ${EVIDENCE_TYPES.join(" | ")} (image/file via attachments, text in body).`;

const categoryField = z
  .enum(GIG_CATEGORIES)
  .optional()
  .describe(gigCategoryHint);

const formExampleHint = `Optional Google-Forms-like schema, max 20 fields. Example: ${JSON.stringify(EXAMPLE_SUBMISSION_FORM)}`;

/**
 * Per-tool field hints for OpenCode. Handlers still validate like HTTP bodies.
 * Kept as ZodRawShape (not .passthrough() objects) so tsc does not blow up on
 * McpServer.registerTool inference.
 */
const shapes: Record<ToolName, Record<string, z.ZodTypeAny>> = {
  issue_connect: {
    potId: z.string().optional(),
    owner: z.string().optional(),
    notify_url: z.string().optional(),
    notifyUrl: z.string().optional(),
    max_bounty_wei: z.string().optional(),
    maxBountyWei: z.string().optional(),
    ttl_secs: z.union([z.number(), z.string()]).optional(),
    ttlSecs: z.union([z.number(), z.string()]).optional(),
    label: z.string().optional(),
  },
  connect: {
    token: z
      .string()
      .optional()
      .describe("proofwork_connect token (or env PROOFWORK_CONNECT_TOKEN)"),
    device_code: z.string().optional(),
    deviceCode: z.string().optional(),
    label: z.string().optional(),
    notify_url: z.string().optional(),
    notifyUrl: z.string().optional(),
  },
  accept_terms: {
    device_code: z.string().optional(),
    deviceCode: z.string().optional(),
    agreed: z.boolean().optional(),
    terms_version: z.string().optional(),
    termsVersion: z.string().optional(),
  },
  authorize_connect: {
    device_code: z.string().optional(),
    deviceCode: z.string().optional(),
    nullifierHash: z.string().optional(),
    potId: z.string().optional(),
    owner: z.string().optional(),
    ttl_secs: z.union([z.number(), z.string()]).optional(),
    ttlSecs: z.union([z.number(), z.string()]).optional(),
  },
  ensure_account: {
    nullifierHash: z.string().optional(),
    label: z.string().optional(),
  },
  get_account: {
    potId: z.string().optional(),
  },
  get_guide: {},
  post: {
    potId: z
      .string()
      .optional()
      .describe("Optional when connect / bearer already bound a pot"),
    rewardWei: z.string(),
    metadata: z.string(),
    agentPassProof: z.string().optional(),
    geo: z.object({ lat: z.number(), lng: z.number() }).optional(),
    deadline_at: z.union([z.string(), z.number()]).optional(),
    deadlineAt: z.union([z.string(), z.number()]).optional(),
    expires_at: z.union([z.string(), z.number()]).optional(),
    expiresAt: z.union([z.string(), z.number()]).optional(),
    ttl_secs: z.union([z.number(), z.string()]).optional(),
    ttlSecs: z.union([z.number(), z.string()]).optional(),
    max_work_secs: z.union([z.number(), z.string()]).optional(),
    maxWorkSecs: z.union([z.number(), z.string()]).optional(),
    respond_sla_secs: z.union([z.number(), z.string()]).optional(),
    respondSlaSecs: z.union([z.number(), z.string()]).optional(),
    notify_url: z.string().optional(),
    notifyUrl: z.string().optional(),
    category: categoryField,
    tags: z.union([z.string(), z.array(z.string())]).optional(),
    title: z.string().optional(),
    poster_agent: z.string().optional(),
    posterAgent: z.string().optional(),
    submission_form: z.unknown().optional().describe(formExampleHint),
    submissionForm: z.unknown().optional(),
    x_payment: z.string().optional().describe(payHint),
  },
  post_gig: {
    potId: z.string().optional(),
    rewardWei: z.string(),
    metadata: z.string(),
    agentPassProof: z.string().optional(),
    geo: z.object({ lat: z.number(), lng: z.number() }).optional(),
    deadline_at: z.union([z.string(), z.number()]),
    deadlineAt: z.union([z.string(), z.number()]).optional(),
    max_work_secs: z.union([z.number(), z.string()]),
    maxWorkSecs: z.union([z.number(), z.string()]).optional(),
    respond_sla_secs: z.union([z.number(), z.string()]).optional(),
    respondSlaSecs: z.union([z.number(), z.string()]).optional(),
    notify_url: z.string().optional(),
    notifyUrl: z.string().optional(),
    category: categoryField,
    tags: z.union([z.string(), z.array(z.string())]).optional(),
    title: z.string().optional(),
    poster_agent: z.string().optional(),
    posterAgent: z.string().optional(),
    submission_form: z.unknown().optional().describe(formExampleHint),
    submissionForm: z.unknown().optional(),
    x_payment: z.string().optional().describe(payHint),
  },
  get: {
    taskId: z
      .string()
      .describe("Task id — connected agents only see tasks on their bearer pot"),
  },
  list: {
    potId: z
      .string()
      .optional()
      .describe(
        "Optional; connected agents are always scoped to their bearer pot (foreign potId rejected)",
      ),
    status: z.array(z.string()).optional(),
    near: z
      .object({ lat: z.number(), lng: z.number(), radiusM: z.number() })
      .optional(),
    reward_min_wei: z.string().optional(),
    reward_max_wei: z.string().optional(),
    category: categoryField,
    tags: z.union([z.string(), z.array(z.string())]).optional(),
    deadline_before: z.union([z.string(), z.number()]).optional(),
    poster_agent: z.string().optional(),
    search: z.string().optional(),
    sort: z
      .enum(["newest", "reward_desc", "reward_asc", "deadline_asc"])
      .optional(),
  },
  pot_status: {
    potId: z.string().optional(),
    nullifierHash: z.string().optional(),
    nullifier_hash: z.string().optional(),
  },
  pot_deposit: {
    potId: z.string().optional(),
    amountWei: z.string(),
    owner: z.string().optional(),
    externalTxId: z.string().optional(),
  },
  pot_set_threshold: {
    potId: z.string().optional(),
    thresholdWei: z.string(),
  },
  request_approval: {
    taskId: z.string(),
    reason: z.string(),
    amountWei: z.string().optional(),
    redirectUri: z.string().optional(),
    x_payment: z.string().optional().describe(payHint),
  },
  cancel: {
    taskId: z.string(),
    x_payment: z.string().optional().describe(payHint),
  },
  accept: {
    taskId: z.string(),
    worker: z.string().optional(),
    humanNullifier: z.string().optional(),
    proof: z.unknown().optional(),
    signal: z.string().optional(),
    action: z.string().optional(),
  },
  submit: {
    taskId: z.string(),
    resultCid: z
      .string()
      .optional()
      .describe("Required when gig has no submission_form"),
    form_response: z
      .record(z.unknown())
      .optional()
      .describe(
        "Required when gig has submission_form — { fieldId: value | attachmentId }",
      ),
    formResponse: z.record(z.unknown()).optional(),
    note: z.string().optional(),
    forceReject: z.boolean().optional(),
  },
  extend_claim: {
    taskId: z.string(),
    extra_secs: z.union([z.number(), z.string()]),
    extraSecs: z.union([z.number(), z.string()]).optional(),
    owner: z.string().optional(),
  },
  thread_list: { taskId: z.string() },
  thread_post: {
    taskId: z.string(),
    role: z.string(),
    body: z.string(),
    kind: z.string().optional(),
  },
  list_messages: { taskId: z.string() },
  send_message: {
    taskId: z.string(),
    role: z.string().optional(),
    body: z.string().optional(),
    kind: z.string().optional(),
    attachmentCid: z.string().optional(),
    attachments: z
      .array(
        z.object({
          filename: z.string().optional(),
          contentType: z.string().optional(),
          content_type: z.string().optional(),
          data: z.string().optional(),
          base64: z.string().optional(),
          url: z.string().optional(),
        }),
      )
      .optional(),
  },
  get_attachment: {
    attachmentId: z.string().optional(),
    id: z.string().optional(),
    include_data: z.boolean().optional(),
    includeData: z.boolean().optional(),
  },
  worker_set_payout: {
    userId: z.string(),
    payoutAddress: z.string(),
  },
  worker_get_payout: {
    userId: z.string(),
  },
  worker_claim_nullifier: {
    accountKey: z.string().optional(),
    userId: z.string().optional(),
  },
  upload_attachment: {
    filename: z.string().optional(),
    contentType: z.string().optional(),
    content_type: z.string().optional(),
    data: z.string().optional().describe("base64 or data-url"),
    base64: z.string().optional(),
    url: z.string().optional(),
  },
  all_satisfied: {
    taskId: z.string(),
    owner: z.string().optional(),
    note: z.string().optional(),
    agentPassProof: z.string().optional(),
  },
  request_changes: {
    taskId: z.string(),
    owner: z.string().optional(),
    message: z.string().optional(),
    note: z.string().optional(),
    body: z.string().optional(),
  },
  dispute: {
    taskId: z.string(),
    owner: z.string().optional(),
    reason: z.string().optional(),
  },
  resolve_dispute: {
    taskId: z.string(),
    owner: z.string().optional(),
    outcome: z.enum(["release", "reopen"]),
    resultCid: z.string().optional(),
    result_cid: z.string().optional(),
    note: z.string().optional(),
    agentPassProof: z.string().optional(),
  },
  list_task_events: { taskId: z.string() },
  wait_task_event: {
    taskId: z.string(),
    timeout_ms: z.number().optional(),
    timeoutMs: z.number().optional(),
    after_id: z.string().optional(),
    afterId: z.string().optional(),
  },
  list_my_gigs_updates: {
    potId: z.string().optional(),
    after_id: z
      .string()
      .optional()
      .describe("Cursor from previous list/wait — never skip"),
    afterId: z.string().optional(),
    cursor: z.string().optional(),
  },
  wait_any_event: {
    potId: z.string().optional(),
    after_id: z
      .string()
      .optional()
      .describe("Cursor from previous response — events after it are never lost"),
    afterId: z.string().optional(),
    cursor: z.string().optional(),
    timeout_ms: z.number().optional(),
    timeoutMs: z.number().optional(),
  },
  verify: {
    taskId: z.string(),
    owner: z.string().optional(),
    teeSig: z.string().optional(),
  },
};

const DESCRIPTIONS: Record<ToolName, string> = {
  issue_connect:
    "Owner desk: mint a short-lived proofwork_connect token bound to a pot.",
  connect:
    "Agent onboarding. No token → terms + authorize URL. With device_code → poll. With token → bind pot.",
  accept_terms:
    "Agent must agree to hardcoded Terms before the human can authorize.",
  authorize_connect:
    "Web panel after World ID — bind device_code to this human's pot.",
  ensure_account:
    "Web sign-in: create or fetch the budget pot for a World nullifier.",
  get_account: `Pot balance (HBAR), gigs, unread, pending_actions (review_submission | reply_to_worker | follow_up), and notifications. Act autonomously — owner is informed, not asked. ${GUIDE_TOOL_TIP}`,
  get_guide:
    "Return the PROOFWORK agent operating guide (autonomous posting agent — same as proofwork://guide and MCP initialize instructions). Read before posting.",
  post: `Post a gig funded from the human's pot (no x_payment). Human funds HBAR at /owner/pot. IMMEDIATELY after success follow response next_steps and start wait_any_event — never ask the owner whether to monitor. Requires connect/bearer. category enum: ${GIG_CATEGORIES.join(", ")}. Evidence types: ${EVIDENCE_TYPES.join(", ")}. ${GUIDE_TOOL_TIP}`,
  post_gig: `Post a gig (deadline_at + max_work_secs required). On success follow next_steps and enter the monitor loop — never ask the owner to poll. category enum: ${GIG_CATEGORIES.join(", ")}. Evidence types: ${EVIDENCE_TYPES.join(", ")}. ${GUIDE_TOOL_TIP}`,
  get: `Fetch one escrow task by id (lazy deadline / claim / SLA sweep; includes submissionForm + formResponse when set). Connected agents only see tasks on their bearer pot. ${GUIDE_TOOL_TIP}`,
  list: `List gigs with filters (status, reward, category, tags, deadline, poster, search, sort). Connected agents are scoped to their bearer pot. Rows may include submissionForm. ${GUIDE_TOOL_TIP}`,
  pot_status: `Budget pot balance + Agent Pass threshold (HBAR). Check before posting. ${GUIDE_TOOL_TIP}`,
  pot_deposit: "Credit the human pot (test helper / webhook replay).",
  pot_set_threshold: "Set Agent Pass approval threshold for a pot.",
  request_approval: "World Agent Pass approval flow (x402 paid).",
  cancel: "Cancel / refund race path (x402 paid).",
  accept: "Worker claim + IDKit Proof of Human gate (starts claim timer).",
  submit:
    "Worker evidence submit. With submission_form: form_response. Without: resultCid (att_ id from send_message — never invent bafy-proof CIDs). Review with get_attachment include_data before all_satisfied.",
  extend_claim: "Posting agent extends claimExpiresAt after chatting.",
  thread_list: "List chat thread messages for a task (form_response cards included).",
  thread_post: `Post a message into the task thread. Be polite and specific. ${GUIDE_TOOL_TIP}`,
  list_messages: "Alias of thread_list — agent↔worker chat history.",
  send_message: `Send chat/evidence with optional attachments (att_<sha256>). Reply within respond_sla_secs. ${GUIDE_TOOL_TIP}`,
  get_attachment:
    "Fetch attachment meta; with include_data returns base64, MCP image content (HEIC→JPEG server-side), and extractedText for text docs — required before all_satisfied.",
  upload_attachment:
    "Upload a file/image for form fields; returns attachmentId for form_response.",
  worker_set_payout: "Worker: save EVM payout address for on-chain release.",
  worker_get_payout: "Worker: read saved EVM payout address.",
  worker_claim_nullifier:
    "Worker: read bound gig Proof-of-Human nullifier for this World account.",
  all_satisfied: `Release escrow on-chain after YOU review evidence (get_attachment + thread). Blocked from DISPUTED — use resolve_dispute release first. ${GUIDE_TOOL_TIP}`,
  request_changes: `Wrong/fixable evidence while SUBMITTED → ACCEPTED for worker resubmit. Message the worker; use this before dispute. ${GUIDE_TOOL_TIP}`,
  dispute: `Only after send_message/request_changes and ~60s without worker reply (or claim expired). Reopens OPEN, unassigns worker, escrow stays locked; prior worker blocked. ${GUIDE_TOOL_TIP}`,
  resolve_dispute: `Legacy DISPUTED only: outcome release (pay worker, uses all_satisfied) or reopen (OPEN). ${GUIDE_TOOL_TIP}`,
  list_task_events:
    "In-process notify log for one task — evidence_submitted may include formResponse.",
  wait_task_event:
    "Long-poll one task (cursor via after_id). Prefer wait_any_event across all open gigs after post.",
  list_my_gigs_updates: `Non-blocking: all new events (claimed/message/submitted/deadline_soon/expired) across open gigs since cursor. Pass returned cursor next. ${GUIDE_TOOL_TIP}`,
  wait_any_event: `REQUIRED after post: long-poll; returns events + pending_actions/notifications (review_submission, reply_to_worker, follow_up). Act autonomously. Loop until no open gigs. ${GUIDE_TOOL_TIP}`,
  verify: "Deprecated — TeePathDemoted; use all_satisfied after reviewing evidence.",
};

function stripPayment(raw: Record<string, unknown>): {
  body: Record<string, unknown>;
  xPayment?: string;
} {
  const { x_payment, X_PAYMENT, ...rest } = raw as Record<string, unknown> & {
    x_payment?: string;
    X_PAYMENT?: string;
  };
  const xPayment =
    typeof x_payment === "string"
      ? x_payment
      : typeof X_PAYMENT === "string"
        ? X_PAYMENT
        : undefined;
  return { body: rest, xPayment };
}

function okText(result: unknown) {
  return {
    content: [{ type: "text" as const, text: jsonText({ result }) }],
  };
}

type McpImageContent = {
  type: "image";
  data: string;
  mimeType: string;
};

type McpTextContent = { type: "text"; text: string };

/** get_attachment with include_data returns MCP image blocks agents can see. */
export function formatToolMcpContent(
  name: ToolName,
  result: unknown,
): { content: Array<McpTextContent | McpImageContent> } {
  if (
    name === "get_attachment" &&
    result &&
    typeof result === "object" &&
    !Array.isArray(result)
  ) {
    const r = result as {
      dataBase64?: string;
      mime?: string;
      contentType?: string;
      extractedText?: string | null;
      mcpImage?: { mimeType: string; data: string } | null;
    };
    const meta = { ...(r as Record<string, unknown>) };
    delete meta.dataBase64;
    delete meta.data;
    delete meta.mcpImage;
    const content: Array<McpTextContent | McpImageContent> = [
      { type: "text", text: jsonText({ result: meta }) },
    ];
    const img = r.mcpImage;
    if (img?.data && img.mimeType) {
      content.push({
        type: "image",
        data: img.data,
        mimeType: img.mimeType,
      });
    } else if (r.dataBase64 && (r.contentType ?? r.mime)?.startsWith("image/")) {
      content.push({
        type: "image",
        data: r.dataBase64,
        mimeType: (r.contentType ?? r.mime)!,
      });
    }
    if (r.extractedText?.trim()) {
      content.push({
        type: "text",
        text: `--- extracted document text ---\n${r.extractedText}`,
      });
    }
    return { content };
  }
  return okText(result);
}

function errText(message: string, extra?: Record<string, unknown>) {
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: jsonText({ error: message, ...extra }),
      },
    ],
  };
}

/** Resolve X-PAYMENT for paid tools from tool arg or env — never invent a fake token. */
export function resolvePaymentHeader(opts: {
  xPaymentArg?: string;
  envDefault?: string;
}): string | undefined {
  if (opts.xPaymentArg && opts.xPaymentArg.trim()) {
    return opts.xPaymentArg.trim();
  }
  if (opts.envDefault && opts.envDefault.trim()) {
    return opts.envDefault.trim();
  }
  return undefined;
}

/** Mutable sticky auth for the HTTP bridge process (OpenCode stdio → MCP). */
export type HttpBridgeAuth = {
  connectToken?: string;
  /** Last pending human-approve URL from a device-flow connect. */
  pendingAuthorizeUrl?: string;
  pendingDeviceCode?: string;
};

export function createHttpBridgeAuth(initial?: string): HttpBridgeAuth {
  const t = initial?.trim();
  return { connectToken: t || undefined };
}

export type BridgeBackend =
  | { kind: "inprocess"; tools: Tools; ports: ComposedPorts }
  | {
      kind: "http";
      baseUrl: string;
      /** Sticky bearer — set only after a successful authorized connect. */
      auth: HttpBridgeAuth;
    };

const POT_FUNDED_BRIDGE_TOOLS = new Set<ToolName>(["post", "post_gig"]);

/** connect / issue_connect / terms — never forward a sticky bearer. */
const AUTH_BOOTSTRAP_TOOLS = new Set<ToolName>([
  "connect",
  "issue_connect",
  "accept_terms",
  "authorize_connect",
]);

export function publicConnectAuthorizeUrl(): string {
  const base = (
    process.env.PROOFWORK_PUBLIC_URL ?? "http://127.0.0.1:38471"
  ).replace(/\/$/, "");
  return `${base}/connect/authorize`;
}

export function connectRecoveryMessage(pendingUrl?: string): string {
  const link = pendingUrl?.trim() || publicConnectAuthorizeUrl();
  return `unknown or expired connect token — call connect, then have the human approve at ${link}`;
}

export function pendingApprovalMessage(authorizeUrl: string): string {
  return `pending human approval at ${authorizeUrl}`;
}

function isUnknownOrExpiredMessage(msg: string): boolean {
  return /unknown or expired connect token|connect token required|unauthorized connect token/i.test(
    msg,
  );
}

/** Pull a pwct_… token out of connect / issue_connect / authorize_connect results. */
export function extractConnectTokenFromResult(
  result: unknown,
): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const r = result as { token?: unknown; status?: unknown };
  // Device-flow pending responses must not stick a token.
  if (
    typeof r.status === "string" &&
    r.status !== "authorized" &&
    r.status !== "ok"
  ) {
    return undefined;
  }
  const token = r.token;
  if (typeof token === "string" && token.startsWith("pwct_")) return token;
  return undefined;
}

function rememberPendingAuthorize(
  auth: HttpBridgeAuth,
  result: unknown,
): void {
  if (!result || typeof result !== "object") return;
  const r = result as {
    status?: unknown;
    authorize_url?: unknown;
    device_code?: unknown;
  };
  const status = typeof r.status === "string" ? r.status : "";
  const pending =
    status === "authorization_required" ||
    status === "pending_user" ||
    status === "pending_terms";
  if (!pending) return;
  if (typeof r.authorize_url === "string" && r.authorize_url.trim()) {
    auth.pendingAuthorizeUrl = r.authorize_url.trim();
  }
  if (typeof r.device_code === "string" && r.device_code.trim()) {
    auth.pendingDeviceCode = r.device_code.trim();
  }
  // Starting / continuing a device flow means we are not authorized yet.
  auth.connectToken = undefined;
}

export async function callHttpTool(
  baseUrl: string,
  name: ToolName,
  body: unknown,
  opts: { paymentHeader?: string; connectToken?: string } = {},
): Promise<unknown> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (opts.paymentHeader) headers["X-PAYMENT"] = opts.paymentHeader;
  // Only the explicit opts token — never silently re-read a stale env mid-call
  // for bootstrap tools (caller passes undefined). Env is a boot default only.
  const connect = opts.connectToken?.trim() || "";
  if (connect) {
    headers.Authorization = `Bearer ${connect}`;
    headers["X-PROOFWORK-CONNECT"] = connect;
  }

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/tools/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
  });

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    // keep raw
  }

  if (res.status === 402) {
    throw new PaymentRequired(
      typeof parsed === "string" ? parsed : jsonText(parsed),
    );
  }
  if (res.status === 401 || res.status === 400) {
    const err =
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      typeof (parsed as { error: unknown }).error === "string"
        ? (parsed as { error: string }).error
        : res.status === 401
          ? "unauthorized connect token"
          : `HTTP ${res.status}`;
    const e = new BadRequest(err);
    (e as BadRequest & { httpStatus?: number }).httpStatus = res.status;
    throw e;
  }
  if (!res.ok) {
    const err =
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      typeof (parsed as { error: unknown }).error === "string"
        ? (parsed as { error: string }).error
        : `HTTP ${res.status}`;
    throw new BadRequest(err);
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    "result" in (parsed as object)
  ) {
    return (parsed as { result: unknown }).result;
  }
  return parsed;
}

/**
 * HTTP-bridge tool dispatch: sticky connect bearer + pot-funded post path.
 * Exported so smoke/unit tests can exercise the same path OpenCode uses.
 */
export async function runHttpBridgeTool(
  backend: Extract<BridgeBackend, { kind: "http" }>,
  name: ToolName,
  args: Record<string, unknown>,
  paid: boolean,
): Promise<unknown> {
  const { body, xPayment } = stripPayment(args);
  const bootstrap = AUTH_BOOTSTRAP_TOOLS.has(name);

  // connect(token="") / connect(token: null) clears sticky before the call.
  if (name === "connect" && "token" in body) {
    const rawTok = body.token;
    if (
      rawTok == null ||
      (typeof rawTok === "string" && !rawTok.trim())
    ) {
      backend.auth.connectToken = undefined;
    } else if (
      typeof rawTok === "string" &&
      rawTok.startsWith("pwct_")
    ) {
      // New token replaces sticky only after a successful authorized response.
      // Clear the old one now so we never resend a stale bearer alongside it.
      backend.auth.connectToken = undefined;
    }
  }

  // Bootstrap tools must not send Authorization — a stale sticky was poisoning
  // connect/issue_connect so the MCP rejected before the body.token was read.
  const connectToken = bootstrap
    ? undefined
    : backend.auth.connectToken?.trim() ||
      process.env.PROOFWORK_CONNECT_TOKEN?.trim() ||
      undefined;

  // Connected post/post_gig debit the pot — do not inject X-PAYMENT: mock.
  const skipAutoPay =
    POT_FUNDED_BRIDGE_TOOLS.has(name) && Boolean(connectToken);
  const paymentHeader = paid
    ? skipAutoPay && !xPayment
      ? undefined
      : resolvePaymentHeader({
          xPaymentArg: xPayment,
          envDefault: process.env.PROOFWORK_MCP_X_PAYMENT,
        })
    : undefined;

  try {
    const result = await callHttpTool(backend.baseUrl, name, body, {
      paymentHeader,
      connectToken,
    });

    const remembered = extractConnectTokenFromResult(result);
    if (remembered) {
      backend.auth.connectToken = remembered;
      backend.auth.pendingAuthorizeUrl = undefined;
      backend.auth.pendingDeviceCode = undefined;
    } else {
      rememberPendingAuthorize(backend.auth, result);
    }
    return result;
  } catch (err) {
    if (err instanceof BadRequest) {
      const httpStatus = (err as BadRequest & { httpStatus?: number })
        .httpStatus;
      const needsReauth =
        httpStatus === 401 ||
        isUnknownOrExpiredMessage(err.message) ||
        /requires connect token/i.test(err.message);
      if (needsReauth) {
        backend.auth.connectToken = undefined;
        throw new BadRequest(
          connectRecoveryMessage(backend.auth.pendingAuthorizeUrl),
        );
      }
    }
    if (
      err instanceof PaymentRequired &&
      POT_FUNDED_BRIDGE_TOOLS.has(name) &&
      backend.auth.pendingAuthorizeUrl
    ) {
      throw new BadRequest(
        pendingApprovalMessage(backend.auth.pendingAuthorizeUrl),
      );
    }
    if (
      err instanceof PaymentRequired &&
      POT_FUNDED_BRIDGE_TOOLS.has(name) &&
      !connectToken
    ) {
      // No sticky bearer — tell the agent to connect (not "pay USDC").
      throw new BadRequest(
        `connected posts need Authorization — call connect, then have the human approve at ${publicConnectAuthorizeUrl()}`,
      );
    }
    throw err;
  }
}

function readonlyHint(name: ToolName): boolean {
  return (
    name === "get" ||
    name === "list" ||
    name === "pot_status" ||
    name === "thread_list" ||
    name === "list_task_events"
  );
}

/** Tools available without Authorization on Streamable HTTP / SSE. */
export const BOOTSTRAP_TOOL_NAMES = new Set<ToolName>([
  "connect",
  "accept_terms",
  "issue_connect",
  "get_guide",
]);

export type CreateProofworkMcpServerOpts = {
  /** Remote Streamable HTTP: only health + bootstrap tools when unauthenticated. */
  bootstrapOnly?: boolean;
  /** Injected into every in-process invokeTool (Bearer from the MCP session). */
  authHeaders?: () => Record<string, string | undefined> | undefined;
};

/**
 * Register every createTools handler on an official MCP server.
 * Also exposes a small `health` tool (mirrors GET /health).
 */
export function createProofworkMcpServer(
  backend: BridgeBackend,
  opts: CreateProofworkMcpServerOpts = {},
): McpServer {
  const guide = loadAgentGuide();
  const server = new McpServer(
    {
      name: "proofwork",
      version: "0.2.0",
    },
    {
      instructions: guide,
      capabilities: {
        resources: {},
      },
    },
  );

  server.registerResource(
    "agent-guide",
    agentGuideUri(),
    {
      title: "PROOFWORK agent guide",
      description:
        "How to operate as a posting agent: lifecycle, stay-active monitoring, etiquette, money rules.",
      mimeType: "text/markdown",
    },
    async () => ({
      contents: [
        {
          uri: agentGuideUri(),
          mimeType: "text/markdown",
          text: loadAgentGuide(),
        },
      ],
    }),
  );

  server.registerResource(
    "proofwork-monitor",
    PROOFWORK_MONITOR_URI,
    {
      title: "proofwork_monitor",
      description:
        "Mandatory self-starting monitor loop — never ask the owner for permission to poll or reply.",
      mimeType: "text/plain",
    },
    async () => ({
      contents: [
        {
          uri: PROOFWORK_MONITOR_URI,
          mimeType: "text/plain",
          text: monitorResourceText(),
        },
      ],
    }),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const register = (name: string, cfg: any, cb: any) => {
    server.registerTool(name, cfg, cb);
  };

  register(
    "health",
    {
      title: "Health",
      description:
        "Compose health + tool list (same shape as GET /health on the HTTP MCP).",
      inputSchema: {},
    },
    async () => {
      if (backend.kind === "http") {
        const res = await fetch(
          `${backend.baseUrl.replace(/\/$/, "")}/health`,
        );
        const body = await res.json();
        return okText(body);
      }
      return okText({
        ok: true,
        service: "proofwork-mcp-stdio",
        bridge: "inprocess",
        tools: TOOL_TABLE.map((t) => t.name),
        backends: backend.ports.health.backends,
        projectionFailures: backend.ports.projector.failureCount(),
        bootstrapOnly: Boolean(opts.bootstrapOnly),
      });
    },
  );

  for (const row of TOOL_TABLE) {
    const name = row.name;
    if (opts.bootstrapOnly && !BOOTSTRAP_TOOL_NAMES.has(name)) {
      continue;
    }
    register(
      name,
      {
        title: name,
        description: `${DESCRIPTIONS[name]}${
          row.paid && name !== "post" && name !== "post_gig"
            ? " [x402 paid]"
            : ""
        }`,
        inputSchema: shapes[name],
        annotations: {
          readOnlyHint: !row.paid && readonlyHint(name),
          openWorldHint: false,
        },
      },
      async (args: Record<string, unknown> | undefined) => {
        const raw = args && typeof args === "object" ? args : {};
        try {
          if (backend.kind === "http") {
            const result = await runHttpBridgeTool(
              backend,
              name,
              raw,
              row.paid,
            );
            return formatToolMcpContent(name, result);
          }

          const { body, xPayment } = stripPayment(raw);
          const authHeaders = opts.authHeaders?.() ?? undefined;
          const connected = Boolean(
            backend.tools.session.get() ||
              (authHeaders &&
                (authHeaders.authorization ||
                  authHeaders["x-proofwork-connect"])),
          );
          const skipAutoPay =
            POT_FUNDED_BRIDGE_TOOLS.has(name) && connected && !xPayment;
          const paymentHeader = row.paid
            ? skipAutoPay
              ? undefined
              : resolvePaymentHeader({
                  xPaymentArg: xPayment,
                  envDefault: process.env.PROOFWORK_MCP_X_PAYMENT,
                })
            : undefined;

          const hit = await invokeTool({
            tools: backend.tools,
            ports: backend.ports,
            name,
            body,
            paymentHeader,
            headers: authHeaders,
            session: backend.tools.session,
          });
          return formatToolMcpContent(name, hit.result);
        } catch (err) {
          if (err instanceof PaymentRequired) {
            let challenge: unknown = err.challenge;
            try {
              challenge = JSON.parse(err.challenge);
            } catch {
              // keep string
            }
            return errText("payment required", {
              status: 402,
              challenge,
              hint: `Connected post/post_gig need Authorization after connect (approve at ${publicConnectAuthorizeUrl()}).`,
            });
          }
          if (err instanceof BadRequest) {
            return errText(err.message, { status: 400 });
          }
          if (err instanceof NotFound) {
            return errText(err.message, { status: 404 });
          }
          if (err instanceof RefundRaceError) {
            return errText(err.message, {
              status: 409,
              reason: err.reason,
            });
          }
          return errText(
            err instanceof Error ? err.message : "tool failed",
            { status: 500 },
          );
        }
      },
    );
  }

  return server;
}
