"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useWeb3Ready } from "@/components/providers/web3-ready";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

type Props = {
  className?: string;
  /** When true, network name rides inside the same connected chip. */
  showChain?: boolean;
  label?: string;
};

/**
 * RainbowKit ConnectButton.Custom → one HeroUI control.
 * Connected: single secondary chip (optional network · address). No emoji.
 */
export function WalletConnect({
  className,
  showChain = false,
  label = "Connect wallet",
}: Props) {
  const ready = useWeb3Ready();
  if (!ready) {
    return (
      <span className="pw-skeleton h-8 w-[7.5rem] rounded-md" aria-hidden />
    );
  }

  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
        openChainModal,
        openConnectModal,
        mounted,
      }) => {
        if (!mounted) {
          return (
            <span
              className="pw-skeleton h-8 w-[7.5rem] rounded-md"
              aria-hidden
            />
          );
        }

        if (!account) {
          return (
            <Button
              size="sm"
              variant="secondary"
              className={cn("h-8", className)}
              onPress={openConnectModal}
            >
              {label}
            </Button>
          );
        }

        if (chain?.unsupported) {
          return (
            <Button
              size="sm"
              variant="danger"
              className={cn("h-8", className)}
              onPress={openChainModal}
            >
              Wrong network
            </Button>
          );
        }

        const chainLabel =
          showChain && chain?.name
            ? chain.name.replace(/ Testnet$/i, "")
            : null;

        return (
          <Button
            size="sm"
            variant="secondary"
            className={cn(
              "h-8 max-w-full gap-1.5 px-2.5 font-normal",
              className,
            )}
            onPress={openAccountModal}
            aria-label="Wallet account"
          >
            {chain?.hasIcon && chain.iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt=""
                src={chain.iconUrl}
                className="size-3.5 shrink-0 rounded-sm"
                style={{ background: chain.iconBackground }}
              />
            ) : null}
            {chainLabel ? (
              <span className="truncate text-[12px] text-muted-foreground">
                {chainLabel}
              </span>
            ) : null}
            {chainLabel ? (
              <span className="text-[11px] text-muted-foreground" aria-hidden>
                ·
              </span>
            ) : null}
            <span className="font-mono text-[11px] tabular-nums">
              {shortAddr(account.address)}
            </span>
          </Button>
        );
      }}
    </ConnectButton.Custom>
  );
}
