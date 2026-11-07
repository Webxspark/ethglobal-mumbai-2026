"use client";

import { useState, useTransition } from "react";
import {
  Checkbox,
  Input,
  Label,
  NumberField,
  TextArea,
  TextField,
} from "@heroui/react";
import { MapPin, Upload } from "lucide-react";
import {
  validateFormResponse,
  type FormFieldValue,
  type FormResponse,
  type SubmissionForm,
  type SubmissionFormField,
} from "@proofwork/shared/browser";
import { SelectField } from "@/components/ui/select-field";
import { Button } from "@/components/ui/button";
import { callMcpTool } from "@/lib/adapters/mcp-client";
import { cn } from "@/lib/utils";

type Props = {
  form: SubmissionForm;
  taskId: string;
  disabled?: boolean;
  onSubmit: (response: FormResponse) => Promise<void>;
};

function emptyValues(
  form: SubmissionForm,
): Record<string, FormFieldValue | undefined> {
  const out: Record<string, FormFieldValue | undefined> = {};
  for (const f of form.fields) {
    if (f.type === "checkbox") out[f.id] = false;
    else if (f.type === "multi_select") out[f.id] = [];
    else out[f.id] = undefined;
  }
  return out;
}

export function SubmissionFormPanel({
  form,
  taskId,
  disabled,
  onSubmit,
}: Props) {
  const [values, setValues] = useState(() => emptyValues(form));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [previews, setPreviews] = useState<Record<string, string>>({});

  function setField(id: string, v: FormFieldValue | undefined) {
    setValues((prev) => ({ ...prev, [id]: v }));
    setError(null);
  }

  async function uploadFile(field: SubmissionFormField, file: File) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        typeof reader.result === "string"
          ? resolve(reader.result)
          : reject(new Error("read failed"));
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.readAsDataURL(file);
    });
    setPreviews((p) => ({ ...p, [field.id]: dataUrl }));
    const row = await callMcpTool<{
      attachmentId: string;
      filename: string;
      contentType: string;
    }>("upload_attachment", {
      filename: file.name || "upload.bin",
      contentType: file.type || undefined,
      data: dataUrl,
    });
    setField(field.id, {
      attachmentId: row.attachmentId,
      filename: row.filename,
      contentType: row.contentType,
    });
  }

  function grabLocation(fieldId: string) {
    if (!navigator.geolocation) {
      setError("Geolocation unavailable in this browser");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setField(fieldId, {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      (err) => setError(err.message || "location denied"),
      { enableHighAccuracy: true, timeout: 12_000 },
    );
  }

  function submit() {
    setError(null);
    const cleaned: FormResponse = {};
    for (const [k, v] of Object.entries(values)) {
      if (v !== undefined) cleaned[k] = v as FormFieldValue;
    }
    const hit = validateFormResponse(form, cleaned);
    if (!hit.ok) {
      setError(hit.error);
      return;
    }
    startTransition(async () => {
      try {
        await onSubmit(hit.response);
      } catch (e) {
        setError(e instanceof Error ? e.message : "submit failed");
      }
    });
  }

  return (
    <div className="space-y-3" data-testid="submission-form" data-task-id={taskId}>
      <p className="text-[12px] font-medium">Submission form</p>
      {form.fields.map((field) => (
        <FieldRow
          key={field.id}
          field={field}
          value={values[field.id]}
          preview={previews[field.id]}
          disabled={disabled || pending}
          onChange={(v) => setField(field.id, v)}
          onUpload={(file) => void uploadFile(field, file)}
          onLocate={() => grabLocation(field.id)}
        />
      ))}
      {error ? (
        <p className="text-[12px] text-[#b42318]" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        className="w-full"
        isDisabled={disabled || pending}
        onPress={submit}
        data-testid="submit-form-btn"
      >
        {pending ? "Submitting…" : "Submit form"}
      </Button>
    </div>
  );
}

function FieldRow({
  field,
  value,
  preview,
  disabled,
  onChange,
  onUpload,
  onLocate,
}: {
  field: SubmissionFormField;
  value: FormFieldValue | undefined;
  preview?: string;
  disabled?: boolean;
  onChange: (v: FormFieldValue | undefined) => void;
  onUpload: (file: File) => void;
  onLocate: () => void;
}) {
  const req = field.required ? " *" : "";
  const help = field.help ? (
    <p className="mt-0.5 text-[11px] text-muted-foreground">{field.help}</p>
  ) : null;

  switch (field.type) {
    case "short_text":
    case "url":
      return (
        <TextField
          fullWidth
          isDisabled={disabled}
          value={typeof value === "string" ? value : ""}
          onChange={(v) => onChange(v)}
          aria-label={field.label}
        >
          <Label>
            {field.label}
            {req}
          </Label>
          <Input
            fullWidth
            variant="secondary"
            type={field.type === "url" ? "url" : "text"}
            placeholder={field.type === "url" ? "https://" : undefined}
          />
          {help}
        </TextField>
      );
    case "long_text":
      return (
        <TextField
          fullWidth
          isDisabled={disabled}
          value={typeof value === "string" ? value : ""}
          onChange={(v) => onChange(v)}
          aria-label={field.label}
        >
          <Label>
            {field.label}
            {req}
          </Label>
          <TextArea fullWidth variant="secondary" rows={3} />
          {help}
        </TextField>
      );
    case "number":
      return (
        <NumberField
          fullWidth
          isDisabled={disabled}
          value={typeof value === "number" ? value : Number.NaN}
          onChange={(n) => onChange(Number.isFinite(n) ? n : undefined)}
          minValue={field.min}
          maxValue={field.max}
          aria-label={field.label}
        >
          <Label>
            {field.label}
            {req}
          </Label>
          <NumberField.Group className="w-full">
            <NumberField.Input className="w-full font-mono tabular-nums" />
          </NumberField.Group>
          {help}
        </NumberField>
      );
    case "select":
      return (
        <div>
          <SelectField
            label={`${field.label}${req}`}
            value={typeof value === "string" ? value : ""}
            options={(field.options ?? []).map((o) => ({ id: o, label: o }))}
            onChange={(id) => onChange(id)}
            className="w-full"
          />
          {help}
        </div>
      );
    case "multi_select": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <fieldset className="space-y-1.5">
          <legend className="text-[12px] font-medium">
            {field.label}
            {req}
          </legend>
          {(field.options ?? []).map((o) => {
            const on = selected.includes(o);
            return (
              <Checkbox
                key={o}
                isSelected={on}
                isDisabled={disabled}
                onChange={(next) => {
                  if (next) onChange([...selected, o]);
                  else onChange(selected.filter((x) => x !== o));
                }}
              >
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Checkbox.Content>{o}</Checkbox.Content>
              </Checkbox>
            );
          })}
          {help}
        </fieldset>
      );
    }
    case "checkbox":
      return (
        <Checkbox
          isSelected={value === true}
          isDisabled={disabled}
          onChange={(next) => onChange(Boolean(next))}
        >
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
          <Checkbox.Content>
            {field.label}
            {req}
            {help}
          </Checkbox.Content>
        </Checkbox>
      );
    case "date":
      return (
        <TextField
          fullWidth
          isDisabled={disabled}
          value={typeof value === "string" ? value : ""}
          onChange={(v) => onChange(v || undefined)}
          aria-label={field.label}
        >
          <Label>
            {field.label}
            {req}
          </Label>
          <Input fullWidth variant="secondary" type="date" />
          {help}
        </TextField>
      );
    case "image":
    case "file": {
      const ref =
        value && typeof value === "object" && "attachmentId" in value
          ? value
          : null;
      return (
        <div className="space-y-1.5">
          <p className="text-[12px] font-medium">
            {field.label}
            {req}
          </p>
          <label
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-[6px] border border-dashed border-[#e6e8eb] bg-white px-3 py-2 text-[12px]",
              disabled && "opacity-50",
            )}
          >
            <Upload className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              {ref?.filename ||
                (field.type === "image" ? "Choose image" : "Choose file")}
            </span>
            <input
              type="file"
              className="sr-only"
              accept={field.type === "image" ? "image/*" : undefined}
              disabled={disabled}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(f);
              }}
            />
          </label>
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt=""
              className="max-h-28 rounded-[4px] object-cover"
            />
          ) : null}
          {ref?.attachmentId ? (
            <p className="font-mono text-[10px] text-muted-foreground">
              {ref.attachmentId.slice(0, 16)}…
            </p>
          ) : null}
          {help}
        </div>
      );
    }
    case "location": {
      const loc =
        value && typeof value === "object" && "lat" in value
          ? (value as { lat: number; lng: number })
          : null;
      return (
        <div className="space-y-1.5">
          <p className="text-[12px] font-medium">
            {field.label}
            {req}
          </p>
          <Button
            size="sm"
            variant="secondary"
            isDisabled={disabled}
            onPress={onLocate}
          >
            <MapPin className="size-3.5" aria-hidden />
            Use my location
          </Button>
          {loc ? (
            <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}
            </p>
          ) : null}
          {help}
        </div>
      );
    }
    default:
      return null;
  }
}
