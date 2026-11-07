"use client";

import { Card } from "@heroui/react";
import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "rounded-[6px] border border-[#e6e8eb] shadow-none bg-white",
        className,
      )}
    >
      <Card.Content className="gap-1 p-3">
        <p className="text-[13px] font-medium">{title}</p>
        {body ? (
          <p className="text-[12px] leading-5 text-muted-foreground">{body}</p>
        ) : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </Card.Content>
    </Card>
  );
}
