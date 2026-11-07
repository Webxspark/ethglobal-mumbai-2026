"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useAccount } from "wagmi";
import { useWeb3Ready } from "@/components/providers/web3-ready";
import { WalletConnect } from "@/components/shell/wallet-connect";
import { Button } from "@/components/ui/button";
import { Copyable } from "@/components/ui/copyable";
import { Toast } from "@/components/ui/toast";
import { useSession } from "@/lib/use-session";
import { shortAddr } from "@/lib/format";

/** Wagmi hooks only after client providers mount. */
export function PayoutProfile() {
  const ready = useWeb3Ready();
  if (!ready) {
    return (
      <section className="space-y-2">
        <div className="flex items-end justify-between gap-3 px-0.5">
          <h2 className="pw-section-title">Payout address</h2>
          <span className="font-mono text-[10px] text-muted-foreground">
            Hedera EVM
          </span>
        </div>
        <div className="pw-skeleton h-24 rounded-md" aria-hidden />
      </section>
    );
  }
  return <PayoutProfileLive />;
}

function PayoutProfileLive() {
  const { session, loading: sessionLoading } = useSession();
  const { address, isConnected } = useAccount();
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const signedIn = Boolean(session?.authenticated && session.nullifierHash);

  const refresh = useCallback(async () => {
    if (!signedIn) return;
    try {
      const res = await fetch("/api/worker/payout", { cache: "no-store" });
      const row = (await res.json()) as {
        payoutAddress?: string | null;
        error?: string;
      };
      if (!res.ok) throw new Error(row.error ?? "payout lookup failed");
      setSaved(row.payoutAddress ?? null);
    } catch {
      /* mcp down — profile stays quiet */
    }
  }, [signedIn]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function save() {
    setError(null);
    setMessage(null);
    if (!signedIn) {
      setError("Sign in with World before saving a payout address.");
      return;
    }
    if (!address) {
      setError("Connect a wallet first.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/worker/payout", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ payoutAddress: address }),
        });
        const json = (await res.json()) as {
          payoutAddress?: string;
          repairedTaskIds?: string[];
          error?: string;
        };
        if (!res.ok) throw new Error(json.error ?? "save failed");
        setSaved(json.payoutAddress ?? address);
        const repaired = json.repairedTaskIds?.length
          ? ` · repaired ${json.repairedTaskIds.length} claim(s)`
          : "";
        setMessage(`Payout address saved · ${shortAddr(address)}${repaired}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "save failed");
      }
    });
  }

  return (
    <section className="space-y-2">
      <div className="flex items-end justify-between gap-3 px-0.5">
        <h2 className="pw-section-title">Payout address</h2>
        <span className="font-mono text-[10px] text-muted-foreground">
          Hedera EVM
        </span>
      </div>
      <div className="rounded-[6px] border border-[#e6e8eb] bg-white p-3 flex flex-col items-stretch gap-3">
        <p className="text-[12px] text-muted-foreground">
          Connect a wallet and save it. When the posting agent calls{" "}
          <span className="font-mono text-[11px]">all_satisfied</span>, HBAR is
          released on-chain to this address (HashScan link in the thread).
        </p>
        {sessionLoading ? (
          <div className="pw-skeleton h-8 rounded-md" aria-hidden />
        ) : !signedIn ? (
          <p className="text-[12px] text-muted-foreground">
            Sign in with World so payout keys to your session — not a demo worker.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <WalletConnect showChain />
          <Button
            size="sm"
            isDisabled={pending || !isConnected || !signedIn}
            onPress={save}
          >
            {pending ? "Saving…" : "Save payout address"}
          </Button>
        </div>
        {saved ? (
          <Copyable value={saved} label="saved" head={8} tail={6} />
        ) : (
          <p className="text-[12px] text-muted-foreground">
            No payout address yet — all_satisfied will refuse until you save one.
          </p>
        )}
        {message ? <Toast tone="ok">{message}</Toast> : null}
        {error ? <Toast tone="error">{error}</Toast> : null}
      </div>
    </section>
  );
}
