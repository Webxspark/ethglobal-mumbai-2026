"use client";

import { useState } from "react";
import { Input, Label, Tag, TagGroup, TextField } from "@heroui/react";

/** Freeform tags → comma string for filters. */
export function TagInput({
  label = "Tags",
  value,
  onChange,
  placeholder = "Add tag…",
}: {
  label?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const tags = value
    .split(/[, ]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  function commit(raw: string) {
    const next = raw.trim().toLowerCase();
    if (!next) return;
    if (tags.includes(next)) {
      setDraft("");
      return;
    }
    onChange([...tags, next].join(","));
    setDraft("");
  }

  function remove(id: string) {
    onChange(tags.filter((t) => t !== id).join(","));
  }

  return (
    <div className="space-y-1.5">
      <TextField
        className="w-full"
        fullWidth
        value={draft}
        onChange={setDraft}
        aria-label={label}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit(draft);
          }
        }}
      >
        <Label>{label}</Label>
        <Input
          className="h-8 text-[12px]"
          variant="secondary"
          placeholder={placeholder}
        />
      </TextField>
      {tags.length > 0 ? (
        <TagGroup
          aria-label={label}
          size="sm"
          onRemove={(keys) => {
            for (const k of keys) remove(String(k));
          }}
        >
          <TagGroup.List>
            {tags.map((t) => (
              <Tag key={t} id={t}>
                {t}
                <Tag.RemoveButton />
              </Tag>
            ))}
          </TagGroup.List>
        </TagGroup>
      ) : null}
    </div>
  );
}
