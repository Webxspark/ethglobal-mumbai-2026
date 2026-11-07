"use client";

import { Chip } from "@heroui/react";
import { cn } from "@/lib/utils";
import { statusLabel } from "@/lib/format";

type Tone = "neutral" | "open" | "active" | "warn" | "good" | "bad" | "world";

export function toneForStatus(status: string): Tone {
  const s = status.toUpperCase();
  if (s === "OPEN") return "open";
  if (s === "ACCEPTED" || s === "SUBMITTED") return "active";
  if (s === "VERIFIED" || s === "PAID") return "good";
  if (s === "DISPUTED" || s === "EXPIRED" || s === "EXPIRED_SLA") return "warn";
  if (s === "CANCELLED" || s === "REFUNDED") return "bad";
  return "neutral";
}

function chipProps(tone: Tone): {
  color?: "default" | "accent" | "success" | "warning" | "danger";
  variant?: "primary" | "secondary" | "tertiary" | "soft";
} {
  switch (tone) {
    case "warn":
      return { color: "warning", variant: "secondary" };
    case "bad":
      return { color: "danger", variant: "secondary" };
    case "good":
      return { color: "default", variant: "secondary" };
    case "active":
    case "world":
      return { color: "accent", variant: "tertiary" };
    default:
      return { color: "default", variant: "tertiary" };
  }
}

export function StatusPill({
  status,
  label,
  tone,
  className,
}: {
  status?: string;
  label?: string;
  tone?: Tone;
  className?: string;
}) {
  const resolved = tone ?? (status ? toneForStatus(status) : "neutral");
  const text = label ?? (status ? statusLabel(status) : "—");
  const props = chipProps(resolved);
  return (
    <Chip
      size="sm"
      color={props.color}
      variant={props.variant}
      className={cn("rounded-[4px]", className)}
    >
      <Chip.Label>{text}</Chip.Label>
    </Chip>
  );
}
