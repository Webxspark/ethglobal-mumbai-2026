"use client";

import { useEffect, useState } from "react";
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { parseEther } from "viem";
import { Label, NumberField } from "@heroui/react";
import { useWeb3Ready } from "@/components/providers/web3-ready";
import { WalletConnect } from "@/components/shell/wallet-connect";
import { AppModal } from "@/components/ui/app-modal";
import { Button } from "@/components/ui/button";
import { CopyIconButton, DefRow } from "@/components/ui/copyable";
import { Toast } from "@/components/ui/toast";
import { pauseLivePolling } from "@/lib/adapters/live-poll";
import { refreshLiveStore } from "@/lib/adapters/live-store";
import { formatHbar, parseHbarToWei } from "@/lib/format";
import { requireSessionPot } from "@/lib/session-pot";
import { useSession } from "@/lib/use-session";
import { budgetPotAbi } from "@/lib/wagmi/budget-pot-abi";
import { hashscanTxUrl, hederaTestnet } from "@/lib/wagmi/chains";
import { potAddress, primaryChainId } from "@/lib/wagmi/config";

type Phase =
  | "idle"
  | "wallet"
  | "sending"
  | "pending"
  | "confirming"
  | "confirmed"
  | "error";

type FundProps = {
  open: boolean;
  onClose: () => void;
  onMessage: (msg: string) => void;
};

/** Gate wagmi hooks until RainbowKit / WagmiProvider are mounted. */
export function FundPotSheet(props: FundProps) {
  const ready = useWeb3Ready();
  if (!ready) {
    return (
      <AppModal open={props.open} onClose={props.onClose} title="Fund pot">
        <p className="text-[13px] text-muted-foreground">Loading wallet…</p>
      </AppModal>
    );
  }
  return <FundPotSheetLive {...props} />;
}

function FundPotSheetLive({ open, onClose, onMessage }: FundProps) {
  const { session } = useSession();
  const pot = potAddress();
  const wantChain = primaryChainId();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: switching } = useSwitchChain();
  const {
    writeContractAsync,
    data: txHash,
    reset: resetWrite,
    isPending: writing,
  } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: wantChain,
  });

  const [amount, setAmount] = useState(5);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [explorer, setExplorer] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPhase("idle");
      setError(null);
      setExplorer(null);
      resetWrite();
      return;
    }
    return pauseLivePolling();
  }, [open, resetWrite]);

  useEffect(() => {
    if (
      !txHash ||
      !receipt.isSuccess ||
      phase === "confirming" ||
      phase === "confirmed"
    ) {
      return;
    }
    let cancelled = false;
    setPhase("confirming");
    setError(null);

    (async () => {
      try {
        const credit = requireSessionPot(session);
        const amountWei = parseHbarToWei(String(amount)).toString();
        const res = await fetch("/api/fund/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            txHash,
            amountWei,
            potId: credit.potId,
            owner: credit.owner,
            from: address,
            chainId: wantChain,
          }),
        });
        const body = (await res.json()) as {
          error?: string;
          reason?: string;
          explorerUrl?: string;
          alreadyCredited?: boolean;
        };
        if (!res.ok) {
          throw new Error(body.reason ?? body.error ?? "confirm failed");
        }
        if (cancelled) return;
        setExplorer(body.explorerUrl ?? hashscanTxUrl(txHash, wantChain));
        setPhase("confirmed");
        try {
          await refreshLiveStore();
        } catch {
          /* MCP may be down */
        }
        onMessage(
          body.alreadyCredited
            ? `Already credited · ${txHash.slice(0, 10)}…`
            : `Funded on-chain · ${formatHbar(parseHbarToWei(String(amount)))}`,
        );
      } catch (e) {
        if (cancelled) return;
        setPhase("error");
        setError(e instanceof Error ? e.message : "confirm failed");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txHash, receipt.isSuccess]);

  async function runPay() {
    setError(null);
    try {
      requireSessionPot(session);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in required");
      setPhase("error");
      return;
    }
    if (!pot) {
      setError(
        "Set NEXT_PUBLIC_BUDGET_POT_ADDRESS (BudgetPot on Hedera testnet).",
      );
      setPhase("error");
      return;
    }
    if (!isConnected || !address) {
      setPhase("wallet");
      setError("Connect a wallet first.");
      return;
    }
    if (chainId !== wantChain) {
      try {
        switchChain?.({ chainId: wantChain });
      } catch {
        setError(`Switch wallet to chain ${wantChain} (Hedera testnet).`);
        setPhase("error");
      }
      return;
    }

    setPhase("sending");
    try {
      const value = parseEther(String(Number(amount) || 0));
      if (value <= 0n) throw new Error("Enter a positive amount");

      const hash = await writeContractAsync({
        address: pot,
        abi: budgetPotAbi,
        functionName: "deposit",
        value,
        chainId: wantChain,
      });
      setExplorer(hashscanTxUrl(hash, wantChain));
      setPhase("pending");
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "send failed");
    }
  }

  const busy =
    phase === "sending" ||
    phase === "pending" ||
    phase === "confirming" ||
    writing ||
    receipt.isLoading;

  let sessionPotLabel: string | null = null;
  try {
    sessionPotLabel = requireSessionPot(session).potId;
  } catch {
    sessionPotLabel = null;
  }

  const amountLabel = Number.isFinite(amount)
    ? String(amount).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1")
    : "0";
  const primaryLabel =
    phase === "sending" || writing
      ? "Confirm in wallet…"
      : phase === "pending"
        ? "Pending…"
        : phase === "confirming"
          ? "Crediting…"
          : phase === "confirmed"
            ? "Done"
            : `Deposit ${amountLabel} HBAR`;

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title="Fund pot"
      footer={
        <>
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button
            className="min-w-[10rem]"
            isDisabled={busy || phase === "confirmed" || !pot || !sessionPotLabel}
            onPress={() => void runPay()}
          >
            {primaryLabel}
          </Button>
        </>
      }
    >
      <p className="text-[13px] leading-5 text-muted-foreground">
        Deposit native HBAR into BudgetPot. Receipt credits your World-bound pot.
      </p>

      <div className="space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.02em] text-muted-foreground">
          Wallet
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <WalletConnect showChain />
          {chainId && chainId !== wantChain ? (
            <Button
              size="sm"
              variant="secondary"
              isDisabled={switching}
              onPress={() => switchChain?.({ chainId: wantChain })}
            >
              Switch network
            </Button>
          ) : null}
        </div>
      </div>

      {!sessionPotLabel ? (
        <Toast tone="error">
          Sign in with World ID before funding — deposits bind to your pot only.
        </Toast>
      ) : !pot ? (
        <Toast tone="error">
          Missing pot address. Set{" "}
          <span className="font-mono">NEXT_PUBLIC_BUDGET_POT_ADDRESS</span>.
        </Toast>
      ) : (
        <dl className="rounded-[6px] border border-[#e6e8eb] px-3">
          <DefRow label="Pot" value={sessionPotLabel} head={10} tail={6} />
          <DefRow label="Contract" value={pot} head={8} tail={6} />
          <DefRow
            label="Network"
            value={hederaTestnet.name}
            display={hederaTestnet.name}
          />
        </dl>
      )}

      <NumberField
        className="w-full"
        fullWidth
        minValue={0}
        step={0.1}
        value={amount}
        isDisabled={busy || phase === "confirmed"}
        onChange={(v) => setAmount(Number.isFinite(v) ? v : 0)}
        aria-label="Amount HBAR"
      >
        <Label>Amount</Label>
        <div className="flex items-center gap-2">
          <NumberField.Group className="min-w-0 flex-1">
            <NumberField.DecrementButton />
            <NumberField.Input className="w-full font-mono tabular-nums" />
            <NumberField.IncrementButton />
          </NumberField.Group>
          <span className="shrink-0 font-mono text-[12px] text-muted-foreground">
            HBAR
          </span>
        </div>
      </NumberField>

      {phase === "pending" || phase === "confirming" ? (
        <p className="text-[13px] text-muted-foreground" role="status">
          {phase === "pending"
            ? "Waiting for chain receipt…"
            : "Verifying on-chain + crediting pot…"}
        </p>
      ) : null}

      {phase === "confirmed" ? (
        <Toast tone="ok">
          Confirmed
          {explorer ? (
            <>
              {" · "}
              <a
                href={explorer}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                HashScan
              </a>
            </>
          ) : null}
        </Toast>
      ) : null}

      {error ? <Toast tone="error">{error}</Toast> : null}

      {txHash && phase !== "confirmed" ? (
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">tx</span>
          <span className="truncate font-mono text-[11px] tabular-nums">
            {txHash.slice(0, 10)}…{txHash.slice(-6)}
          </span>
          <CopyIconButton value={txHash} label="Copy tx hash" />
        </div>
      ) : null}
    </AppModal>
  );
}
