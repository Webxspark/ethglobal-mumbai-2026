"use client";

import Link from "next/link";
import { Chip } from "@heroui/react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/use-session";

export function AccountChip() {
  const { session, loading, logout } = useSession();

  if (loading) {
    return <span className="pw-skeleton h-7 w-28 rounded-md" aria-hidden />;
  }

  if (!session?.authenticated) {
    return (
      <Link href="/" className="inline-flex">
        <Chip size="sm" variant="secondary" className="rounded-[4px]">
          <Chip.Label>Sign in</Chip.Label>
        </Chip>
      </Link>
    );
  }

  const hash = session.nullifierHash ?? "";
  const short = hash ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : "World ID";
  const level = session.verificationLevel;

  return (
    <Button
      variant="ghost"
      size="sm"
      className="pw-account-chip h-7 gap-1.5 px-1.5"
      onPress={() => void logout()}
      aria-label="Sign out"
    >
      <span className="pw-account-chip__orb" aria-hidden />
      <span className="pw-account-chip__meta">
        <span className="pw-account-chip__id">{short}</span>
        {level && level !== "none" ? (
          <Chip size="sm" variant="tertiary" className="rounded-[4px]">
            <Chip.Label>{level}</Chip.Label>
          </Chip>
        ) : null}
      </span>
    </Button>
  );
}
