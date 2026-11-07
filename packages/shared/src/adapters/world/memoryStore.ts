import type { ApprovalRecord } from "../../worldAuthTypes.js";

/** Process-local approval inbox — swap for durable store in production. */
export class ApprovalMemoryStore {
  private readonly byId = new Map<string, ApprovalRecord>();

  put(record: ApprovalRecord): void {
    this.byId.set(record.approvalId, record);
  }

  get(approvalId: string): ApprovalRecord | undefined {
    return this.byId.get(approvalId);
  }

  update(
    approvalId: string,
    patch: Partial<ApprovalRecord>,
  ): ApprovalRecord | undefined {
    const cur = this.byId.get(approvalId);
    if (!cur) return undefined;
    const next = { ...cur, ...patch };
    this.byId.set(approvalId, next);
    return next;
  }

  clear(): void {
    this.byId.clear();
  }

  list(): ApprovalRecord[] {
    return [...this.byId.values()];
  }
}

export const sharedApprovalStore = new ApprovalMemoryStore();
