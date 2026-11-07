"use client";

import { cn } from "@/lib/utils";

/** Minimal World mark — solid disc + ring, no emoji / grey placeholder orb. */
export function WorldMark({
  className,
  size = 40,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      <circle cx="20" cy="20" r="19" fill="#0a0a0a" />
      <circle cx="20" cy="20" r="11.5" stroke="#fff" strokeWidth="1.5" />
      <ellipse
        cx="20"
        cy="20"
        rx="5"
        ry="11.5"
        stroke="#fff"
        strokeWidth="1.5"
      />
      <path d="M8.5 20h23" stroke="#fff" strokeWidth="1.5" />
    </svg>
  );
}
