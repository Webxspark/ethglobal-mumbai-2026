"use client";

import { useState } from "react";
import { Chip, Tooltip } from "@heroui/react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function trunc(addr: string, head = 6, tail = 4) {
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

/** Icon-only copy — ghost sm, tooltip. Never bare "Copy" text. */
export function CopyIconButton({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <Tooltip delay={200}>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        className="size-7 min-w-7"
        aria-label={copied ? "Copied" : label}
        onPress={() => void copy()}
      >
        {copied ? (
          <Check className="size-3.5" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
      </Button>
      <Tooltip.Content className="rounded-[4px] px-2 py-1 text-[11px]">
        {copied ? "Copied" : label}
      </Tooltip.Content>
    </Tooltip>
  );
}

/** Label / truncated value / icon copy — for definition lists. */
export function Copyable({
  value,
  label,
  className,
  head = 6,
  tail = 4,
  showChip = true,
}: {
  value: string;
  label?: string;
  className?: string;
  head?: number;
  tail?: number;
  showChip?: boolean;
}) {
  return (
    <div className={cn("inline-flex max-w-full items-center gap-1", className)}>
      {label ? (
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {label}
        </span>
      ) : null}
      {showChip ? (
        <Chip
          size="sm"
          variant="secondary"
          className="max-w-full rounded-[4px]"
          title={value}
        >
          <Chip.Label className="font-mono text-[11px] tabular-nums">
            {trunc(value, head, tail)}
          </Chip.Label>
        </Chip>
      ) : (
        <span
          className="truncate font-mono text-[12px] tabular-nums"
          title={value}
        >
          {trunc(value, head, tail)}
        </span>
      )}
      <CopyIconButton value={value} />
    </div>
  );
}

/** Definition row: label | value + copy */
export function DefRow({
  label,
  value,
  display,
  head = 8,
  tail = 6,
}: {
  label: string;
  value: string;
  display?: string;
  head?: number;
  tail?: number;
}) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-2 border-b border-[#e6e8eb] py-2 last:border-b-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd
        className="min-w-0 truncate font-mono text-[12px] tabular-nums"
        title={value}
      >
        {display ?? trunc(value, head, tail)}
      </dd>
      <CopyIconButton value={value} label={`Copy ${label.toLowerCase()}`} />
    </div>
  );
}
