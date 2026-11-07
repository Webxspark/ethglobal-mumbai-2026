"use client";

import type { Key } from "@heroui/react";
import { Label, ListBox, Select } from "@heroui/react";
import { cn } from "@/lib/utils";

export type SelectOption = { id: string; label: string };

/** Compact HeroUI Select + ListBox (RAC selectedKey — not native <select>). */
export function SelectField({
  label,
  value,
  options,
  onChange,
  className,
  placeholder = "Select",
  "aria-label": ariaLabel,
}: {
  label?: string;
  value: string;
  options: SelectOption[];
  onChange: (id: string) => void;
  className?: string;
  placeholder?: string;
  "aria-label"?: string;
}) {
  return (
    <Select
      className={cn("min-w-[9rem]", className)}
      placeholder={placeholder}
      variant="secondary"
      selectedKey={value || null}
      onSelectionChange={(key: Key | null) => {
        if (key != null) onChange(String(key));
      }}
      aria-label={ariaLabel ?? label}
    >
      {label ? <Label>{label}</Label> : null}
      <Select.Trigger className="h-8 min-h-8 rounded-[6px] border border-[#e6e8eb] bg-white px-2.5 text-[12px]">
        <Select.Value className="text-[12px]" />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover className="rounded-[6px] border border-[#e6e8eb] bg-white shadow-none">
        <ListBox>
          {options.map((o) => (
            <ListBox.Item
              key={o.id}
              id={o.id}
              textValue={o.label}
              className="text-[12px]"
            >
              {o.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
