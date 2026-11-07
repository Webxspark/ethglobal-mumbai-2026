import type { ArkivPort } from "../ports/index.js";
import type { DomainEvent, EscrowTask } from "../types.js";
import type { HcsBundle } from "./hcs/index.js";

export type Projector = {
  project(task: EscrowTask | null, events: DomainEvent[]): Promise<{
    hcs: { sequenceNumber: string }[];
    failures: string[];
  }>;
  failureCount(): number;
};

const FEED_REFRESH_EVENTS = new Set([
  "TaskPosted",
  "TaskAccepted",
  "TaskSubmitted",
  "Verified",
  "AgentSatisfied",
  "TaskDisputed",
  "Paid",
  "TaskExpired",
  "SlaBreached",
]);

const FEED_DROP_EVENTS = new Set([
  "Paid",
  "RefundWon",
  "TaskDisputed",
  "TaskExpired",
  "SlaBreached",
]);

/**
 * Thin sync projector (graft: A’s single projector, B’s HCS+Arkiv subscribers).
 * Escrow remains SoT; projections never invent balances.
 *
 * Arkiv nearby realism: upsert geo entity on post/accept/submit so judges see
 * the pin update; drop on Paid/RefundWon so available feed shrinks after payout.
 */
export function createProjector(deps: {
  hcs: HcsBundle;
  arkiv: ArkivPort;
}): Projector {
  let failures = 0;

  return {
    failureCount: () => failures,

    async project(task, events) {
      const hcs: { sequenceNumber: string }[] = [];
      const failMsgs: string[] = [];

      for (const event of events) {
        try {
          const r = await deps.hcs.port.append(event);
          hcs.push(r);
        } catch (err) {
          failures += 1;
          failMsgs.push(
            err instanceof Error ? err.message : "hcs append failed",
          );
        }

        if (!task?.geo) continue;

        if (FEED_REFRESH_EVENTS.has(event.type)) {
          try {
            if (FEED_DROP_EVENTS.has(event.type)) {
              // Expire entity: upsert with past expiry via cleared geo clone.
              await deps.arkiv.upsertTaskEntity({
                ...task,
                geo: null,
              });
            } else {
              await deps.arkiv.upsertTaskEntity(task);
            }
          } catch (err) {
            failures += 1;
            const msg =
              err instanceof Error ? err.message : "arkiv upsert failed";
            failMsgs.push(msg);
            console.error(
              `[arkiv] upsert failed task=${task.id} event=${event.type}: ${msg}`,
            );
          }
        }
      }

      return { hcs, failures: failMsgs };
    },
  };
}
