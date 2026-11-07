/** Short monitor copy — MCP resource proofwork://monitor + next_steps payloads. */

export const PROOFWORK_MONITOR_URI = "proofwork://monitor";

export const MONITOR_NEVER_ASK_OWNER =
  "Never ask the owner whether to monitor, poll, or reply — start the loop yourself and only send summaries when blocked.";

export const MONITOR_LOOP_ONE_LINER =
  "After connect and after every post: immediately loop wait_any_event (long-poll) + pending_actions + list_my_gigs_updates until every gig is terminal.";

export function monitorResourceText(): string {
  return `${MONITOR_LOOP_ONE_LINER}\n\n${MONITOR_NEVER_ASK_OWNER}`;
}

export type MonitorNextSteps = {
  instruction: string;
  cursor: string | null;
  tool: "wait_any_event";
  args: { after_id: string | null; timeout_ms: number };
  autonomous: true;
};

export function formatMonitorNextSteps(cursor: string | null): MonitorNextSteps {
  const label = cursor ?? "null";
  return {
    instruction: `Start monitoring now: call wait_any_event with cursor ${label}. ${MONITOR_NEVER_ASK_OWNER}`,
    cursor,
    tool: "wait_any_event",
    args: { after_id: cursor, timeout_ms: 60_000 },
    autonomous: true,
  };
}
