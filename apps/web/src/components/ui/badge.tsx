"use client";

import { Chip } from "@heroui/react";
import { cn } from "@/lib/utils";

/** Thin Badge shim → HeroUI Chip (keeps existing call sites). */
export function Badge({
  className,
  variant = "secondary",
  children,
  ...props
}: {
  className?: string;
  variant?: "default" | "secondary" | "destructive" | "outline" | "ghost" | "link";
  children?: React.ReactNode;
  [key: string]: unknown;
}) {
  const color =
    variant === "destructive"
      ? "danger"
      : variant === "default"
        ? "default"
        : "default";
  const chipVariant =
    variant === "outline" || variant === "secondary"
      ? "secondary"
      : variant === "ghost"
        ? "tertiary"
        : "secondary";

  return (
    <Chip
      size="sm"
      color={color}
      variant={chipVariant}
      className={cn("rounded-[4px]", className)}
      {...props}
    >
      <Chip.Label>{children}</Chip.Label>
    </Chip>
  );
}

export function badgeVariants() {
  return "";
}
