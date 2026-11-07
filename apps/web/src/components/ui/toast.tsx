"use client";

import { toast as heroToast } from "@heroui/react";
import { cn } from "@/lib/utils";

/** Imperative helper — needs <Toast.Provider /> in the root layout. */
export function notify(
  message: string,
  tone: "ok" | "error" | "info" = "ok",
) {
  heroToast(message, {
    variant: tone === "error" ? "danger" : "default",
    timeout: 4200,
  });
}

/** Inline status strip (forms / sheets). Prefer notify() for transient feedback. */
export function Toast({
  children,
  tone = "ok",
  className,
}: {
  children: React.ReactNode;
  tone?: "ok" | "error" | "info";
  className?: string;
}) {
  if (tone === "error") {
    return (
      <p className={cn("pw-error", className)} role="alert">
        {children}
      </p>
    );
  }
  return (
    <p
      className={cn(
        "pw-toast",
        tone === "info" && "pw-toast--info",
        className,
      )}
      role="status"
    >
      {children}
    </p>
  );
}
