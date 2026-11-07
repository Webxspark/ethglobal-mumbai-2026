"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Breadcrumbs, Button } from "@heroui/react";
import { Menu, Search } from "lucide-react";
import { OWNER_NAV, WORKER_NAV } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { AccountChip } from "@/components/shell/account-chip";
import { BrandLockup } from "@/components/shell/brand-lockup";
import { NetworkBadge } from "@/components/shell/network-badge";

const WalletButton = dynamic(
  () =>
    import("@/components/shell/wallet-button").then((m) => m.WalletButton),
  {
    ssr: false,
    loading: () => (
      <span className="pw-skeleton h-7 w-[7rem] rounded-md" aria-hidden />
    ),
  },
);

function navActive(pathname: string, href: string) {
  if (href === "/owner") return pathname === "/owner";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export type Crumb = { label: string; href?: string };

export function AppShell({
  children,
  title,
  subtitle,
  breadcrumb,
  actions,
  flush = false,
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  breadcrumb?: Crumb[];
  actions?: React.ReactNode;
  /** Full-bleed content (messages desk) — skips page chrome padding. */
  flush?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const crumbs: Crumb[] =
    breadcrumb ??
    (pathname.startsWith("/worker") || pathname.startsWith("/feed")
      ? [{ label: "Worker" }, { label: title }]
      : [{ label: "Owner" }, { label: title }]);

  return (
    <div className="pw-desk">
      <aside
        className={cn("pw-sidebar", open && "pw-sidebar--open")}
        aria-label="App"
      >
        <div className="pw-sidebar__brand">
          <BrandLockup onClick={() => setOpen(false)} />
        </div>

        <nav className="pw-sidebar__nav">
          <p className="pw-sidebar__group">Owner</p>
          {OWNER_NAV.map((item) => {
            const active = navActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn("pw-side-link", active && "pw-side-link--active")}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                <Icon aria-hidden />
                <span>{item.label}</span>
              </Link>
            );
          })}

          <p className="pw-sidebar__group">Worker</p>
          {WORKER_NAV.map((item) => {
            const active = navActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn("pw-side-link", active && "pw-side-link--active")}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                <Icon aria-hidden />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="pw-sidebar__foot">
          <Button
            variant="ghost"
            isDisabled
            className="pw-kbd-hint h-8 w-full justify-between px-2"
            aria-label="Search soon"
          >
            <span className="inline-flex items-center gap-1.5">
              <Search className="size-3.5" aria-hidden />
              Search
            </span>
            <kbd>⌘K</kbd>
          </Button>
        </div>
      </aside>

      {open ? (
        <Button
          variant="ghost"
          className="pw-sidebar-scrim h-auto min-h-0 rounded-none p-0"
          aria-label="Close menu"
          onPress={() => setOpen(false)}
        />
      ) : null}

      <div className="pw-desk__main">
        <header className="pw-topbar pw-topbar--desk">
          <div className="pw-topbar__inner">
            <div className="pw-topbar__left">
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                aria-label="Open navigation"
                className="pw-menu-btn !h-7 !w-7"
                onPress={() => setOpen(true)}
              >
                <Menu className="size-4" aria-hidden />
              </Button>
              <p className="hidden text-[12px] text-muted-foreground sm:block">
                Hedera testnet · HBAR
              </p>
            </div>
            <div className="pw-topbar__right">
              <NetworkBadge />
              <AccountChip />
              <div className="pw-wallet-slot">
                <WalletButton />
              </div>
            </div>
          </div>
        </header>

        <main
          className={cn(
            "pw-desk__content",
            flush && "pw-desk__content--flush",
          )}
        >
          {flush ? (
            <h1 className="sr-only">{title}</h1>
          ) : (
            <div className="pw-page-head">
              <Breadcrumbs className="text-[12px]" separator="/">
                {crumbs.map((c, i) => (
                  <Breadcrumbs.Item
                    key={`${c.label}-${i}`}
                    href={c.href}
                    className={cn(
                      !c.href && i === crumbs.length - 1 && "text-foreground",
                    )}
                  >
                    {c.label}
                  </Breadcrumbs.Item>
                ))}
              </Breadcrumbs>
              <div className="pw-page-head__row">
                <div className="min-w-0">
                  <h1 className="pw-page-title">{title}</h1>
                  {subtitle ? <p className="pw-page-sub">{subtitle}</p> : null}
                </div>
                {actions ? (
                  <div className="pw-page-head__actions">{actions}</div>
                ) : null}
              </div>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
