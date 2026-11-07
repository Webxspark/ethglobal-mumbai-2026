import type { DomainEvent } from "../../types.js";
import type { HcsBundle } from "./mock.js";

/**
 * Live HCS adapter. Requires operator keys at construction.
 * Topic submit via @hiero-ledger/sdk is not packaged yet — append fails
 * loudly (projector records the failure). No mock fallback.
 */
export function createLiveHcs(env: {
  topicId: string;
  operatorId: string;
  operatorKey: string;
  network?: string;
}): HcsBundle {
  if (!env.topicId.trim() || !env.operatorId.trim() || !env.operatorKey.trim()) {
    throw new Error(
      "proofwork boot: HCS requires topicId, operatorId, operatorKey",
    );
  }

  const port = {
    async append(event: DomainEvent) {
      void event;
      throw new Error(
        `HCS TopicMessageSubmitTransaction not wired for topic ${env.topicId} (network=${env.network ?? "testnet"}). Install and wire @hiero-ledger/sdk — no in-process fallback.`,
      );
    },
  };
  return {
    port,
    async readRecent() {
      return [];
    },
  };
}
