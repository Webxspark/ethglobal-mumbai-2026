import { NextResponse } from "next/server";
import type { Hash, Hex } from "viem";
import { getCredited, markCredited } from "@/lib/fund/credited-txs";
import { callMcpToolServer } from "@/lib/fund/mcp-server";
import { verifyFundTxOnChain } from "@/lib/fund/verify-tx";
import { readSession } from "@/lib/session";
import { resolveFundCreditTarget } from "@/lib/session-pot";
import { hashscanTxUrl } from "@/lib/wagmi/chains";
import { weibarFromTinybar } from "@proofwork/shared/browser";

type Body = {
  txHash?: string;
  amountWei?: string;
  /** Ignored — credit always targets the signed-in session pot. */
  potId?: string;
  /** Ignored — credit always targets the signed-in session owner. */
  owner?: string;
  from?: string;
  chainId?: number;
};

function potAddr(): Hex | null {
  const raw = process.env.NEXT_PUBLIC_BUDGET_POT_ADDRESS?.trim();
  if (!raw || !/^0x[a-fA-F0-9]{40}$/.test(raw)) return null;
  return raw as Hex;
}

/**
 * After the wallet pays on-chain: verify via Hashio/RPC, then credit the
 * signed-in user's MCP pot (idempotent on tx hash). Never the smoke demo pot.
 */
export async function POST(req: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const session = await readSession();
  let credit: { potId: string; owner: string; nullifierHash: string };
  try {
    credit = resolveFundCreditTarget(session);
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Sign in with World ID to fund",
      },
      { status: 401 },
    );
  }

  const txHash = body.txHash?.trim() as Hash | undefined;
  const amountWei = body.amountWei?.trim();
  const from = body.from?.trim() as Hex | undefined;
  const chainId = body.chainId ?? Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 296);

  if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return NextResponse.json({ error: "txHash required" }, { status: 400 });
  }
  if (!amountWei || !/^\d+$/.test(amountWei)) {
    return NextResponse.json({ error: "amountWei required" }, { status: 400 });
  }

  const pot = potAddr();
  if (!pot) {
    return NextResponse.json(
      {
        error:
          "NEXT_PUBLIC_BUDGET_POT_ADDRESS unset — deploy BudgetPot or set a receive address",
      },
      { status: 503 },
    );
  }

  const prior = getCredited(txHash);
  if (prior) {
    return NextResponse.json({
      ok: true,
      alreadyCredited: true,
      txHash,
      potId: prior.potId,
      amountWei: prior.amountWei,
      explorerUrl: hashscanTxUrl(txHash, chainId),
    });
  }

  const depositTinybar = BigInt(amountWei);
  const checked = await verifyFundTxOnChain({
    txHash,
    expectedTo: pot,
    expectedFrom: from,
    minValueWei: weibarFromTinybar(depositTinybar),
    chainId,
  });

  if (!checked.ok) {
    return NextResponse.json(
      { error: "on-chain verify failed", reason: checked.reason, txHash },
      { status: 422 },
    );
  }

  // Ensure pot exists in MCP registry (survives restart via disk + lazy create).
  try {
    await callMcpToolServer("ensure_account", {
      nullifierHash: credit.nullifierHash,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "ensure_account failed",
        reason: e instanceof Error ? e.message : String(e),
        txHash,
        verified: true,
      },
      { status: 502 },
    );
  }

  // Credit the session user's pot — same store MCP pot_status / get_account reads.
  let status: Record<string, unknown>;
  try {
    status = await callMcpToolServer<Record<string, unknown>>("pot_deposit", {
      potId: credit.potId,
      amountWei,
      owner: credit.owner,
      externalTxId: txHash,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "pot_deposit failed",
        reason: e instanceof Error ? e.message : String(e),
        txHash,
        verified: true,
      },
      { status: 502 },
    );
  }

  markCredited({
    txHash,
    potId: credit.potId,
    amountWei,
    creditedAt: Date.now(),
  });

  return NextResponse.json({
    ok: true,
    alreadyCredited: false,
    txHash,
    from: checked.from,
    to: checked.to,
    valueWei: checked.valueWei.toString(),
    potId: credit.potId,
    owner: credit.owner,
    pot: status,
    explorerUrl: hashscanTxUrl(txHash, chainId),
  });
}
