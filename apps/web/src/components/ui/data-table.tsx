"use client";

import { Table } from "@heroui/react";
import { cn } from "@/lib/utils";

type Col = {
  key: string;
  label: string;
  isRowHeader?: boolean;
  className?: string;
  align?: "left" | "right";
};

export function DataTable({
  ariaLabel,
  columns,
  children,
  className,
}: {
  ariaLabel: string;
  columns: Col[];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Table
      variant="secondary"
      className={cn("rounded-[6px] border border-[#e6e8eb] overflow-hidden", className)}
    >
      <Table.ScrollContainer>
        <Table.Content aria-label={ariaLabel} className="min-w-full">
          <Table.Header>
            {columns.map((c) => (
              <Table.Column
                key={c.key}
                isRowHeader={c.isRowHeader}
                className={cn(
                  "h-8 text-[11px] font-medium uppercase tracking-[0.02em] text-[#6b7280]",
                  c.align === "right" && "text-right",
                  c.className,
                )}
              >
                {c.label}
              </Table.Column>
            ))}
          </Table.Header>
          <Table.Body>{children}</Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

export { Table };
