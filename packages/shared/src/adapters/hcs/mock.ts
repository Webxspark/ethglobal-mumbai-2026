import { createHash } from "node:crypto";
import type { HcsAuditPort } from "../../ports/index.js";
import type { DomainEvent } from "../../types.js";

export type AuditLine = {
  sequenceNumber: string;
  event: DomainEvent;
  at: number;
};

export type HcsBundle = {
  port: HcsAuditPort;
  readRecent(limit: number): Promise<readonly AuditLine[]>;
};

function canonical(event: DomainEvent): string {
  return JSON.stringify({ v: 1, event }, (_, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
}

export function createMockHcs(): HcsBundle {
  const lines: AuditLine[] = [];
  const seen = new Map<string, string>();

  const port: HcsAuditPort = {
    async append(event) {
      const bytes = canonical(event);
      if (Buffer.byteLength(bytes, "utf8") > 1024) {
        throw new Error("hcs: payload exceeds 1KB");
      }
      const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
      const sequenceNumber = `mock:${digest}`;
      const prior = seen.get(digest);
      if (prior) {
        return { sequenceNumber: prior };
      }
      seen.set(digest, sequenceNumber);
      lines.push({
        sequenceNumber,
        event,
        at: Math.floor(Date.now() / 1000),
      });
      return { sequenceNumber };
    },
  };

  return {
    port,
    async readRecent(limit) {
      return lines.slice(-Math.max(0, limit));
    },
  };
}
