/**
 * Shared helpers for scripts/smoke*.ts — against a live MCP HTTP server.
 * For in-process checks use NODE_ENV=test + createTestPorts (see smoke-stdio).
 */

/** x402 mock gate accepts base64 JSON when scheme+amount match (see @proofwork/shared mock x402). */
export function mockX402PaymentHeader(): Record<string, string> {
  const payload = {
    scheme: "exact",
    network: "hedera:testnet",
    payload: {
      authorization: {
        from: "0x1111111111111111111111111111111111111111",
        value: "10000",
      },
    },
  };
  return {
    "X-PAYMENT": Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
  };
}

/** Minimal proof shape for stub HumanPort when humanNullifier is set out-of-band. */
export function stubIdKitProof(): Record<string, string> {
  return { environment: "stub", note: "smoke-helper" };
}

export async function smokeEnsureFundedPot(
  baseUrl: string,
  nullifierHash: string,
  fundWei: bigint,
): Promise<{ potId: string; owner: string }> {
  const root = baseUrl.replace(/\/$/, "");
  const ensured = await fetch(`${root}/tools/ensure_account`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nullifierHash, label: "smoke" }),
  }).then((r) => r.json()) as { result: { potId: string; owner: string } };
  if (!ensured.result?.potId) {
    throw new Error(`ensure_account failed: ${JSON.stringify(ensured)}`);
  }
  const { potId, owner } = ensured.result;
  const dep = await fetch(`${root}/tools/pot_deposit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      potId,
      owner,
      amountWei: fundWei.toString(),
    }),
  }).then((r) => r.json());
  const err = (dep as { error?: string }).error;
  if (err) throw new Error(`pot_deposit: ${err}`);
  return { potId, owner };
}

export async function smokeIssueConnect(
  baseUrl: string,
  potId: string,
  owner: string,
  ttlSecs = 900,
  label = "smoke",
): Promise<string> {
  const root = baseUrl.replace(/\/$/, "");
  const issued = await fetch(`${root}/tools/issue_connect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ potId, owner, ttl_secs: ttlSecs, label }),
  }).then((r) => r.json()) as { result?: { token?: string }; error?: string };
  const token = issued.result?.token;
  if (!token) {
    throw new Error(`issue_connect failed: ${JSON.stringify(issued)}`);
  }
  return token;
}
