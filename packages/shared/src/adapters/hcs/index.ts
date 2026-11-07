import { createLiveHcs } from "./live.js";
import type { HcsBundle, AuditLine } from "./mock.js";

export type { HcsBundle, AuditLine };

export type HcsEnv = {
  topicId: string;
  operatorId: string;
  operatorKey: string;
  network?: string;
};

/** Live HCS only. In-memory double: adapters/hcs/mock.ts (tests). */
export function createHcsAudit(env: HcsEnv): HcsBundle {
  if (!env.topicId || !env.operatorId || !env.operatorKey) {
    throw new Error(
      "proofwork boot: Hedera HCS requires HEDERA_HCS_TOPIC_ID, HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY",
    );
  }
  return createLiveHcs({
    topicId: env.topicId,
    operatorId: env.operatorId,
    operatorKey: env.operatorKey,
    network: env.network,
  });
}
