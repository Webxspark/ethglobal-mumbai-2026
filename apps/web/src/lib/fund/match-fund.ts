export type FundCheckInput = {
  from: string;
  to: string | null;
  value: bigint;
  status: "success" | "reverted" | null;
};

export type FundExpect = {
  expectedTo: string;
  expectedFrom?: string;
  minValueWei: bigint;
};

export type FundCheckOk = {
  ok: true;
  from: string;
  to: string;
  valueWei: bigint;
};

export type FundCheckFail = {
  ok: false;
  reason: string;
};

/** Pure matcher — unit-tested without RPC. */
export function matchFundTx(
  tx: FundCheckInput,
  expect: FundExpect,
): FundCheckOk | FundCheckFail {
  if (tx.status !== "success") {
    return { ok: false, reason: "transaction not successful on-chain" };
  }
  if (!tx.to) {
    return { ok: false, reason: "tx has no recipient (contract create?)" };
  }
  if (tx.to.toLowerCase() !== expect.expectedTo.toLowerCase()) {
    return {
      ok: false,
      reason: `tx.to ${tx.to} != pot ${expect.expectedTo}`,
    };
  }
  if (
    expect.expectedFrom &&
    tx.from.toLowerCase() !== expect.expectedFrom.toLowerCase()
  ) {
    return {
      ok: false,
      reason: `tx.from ${tx.from} != sender ${expect.expectedFrom}`,
    };
  }
  if (tx.value < expect.minValueWei) {
    return {
      ok: false,
      reason: `value ${tx.value} < expected ${expect.minValueWei}`,
    };
  }
  return {
    ok: true,
    from: tx.from,
    to: tx.to,
    valueWei: tx.value,
  };
}
