/**
 * Process-local idempotency for fund credits.
 * Survives across requests in the same Next/MCP node; resets on restart.
 * MCP pot_deposit also dedupes on externalTxId when present.
 */

type CreditRow = {
  txHash: string;
  potId: string;
  amountWei: string;
  creditedAt: number;
};

const byHash = new Map<string, CreditRow>();

export function getCredited(txHash: string): CreditRow | undefined {
  return byHash.get(txHash.toLowerCase());
}

export function markCredited(row: CreditRow): void {
  byHash.set(row.txHash.toLowerCase(), row);
}

export function creditedCount(): number {
  return byHash.size;
}
