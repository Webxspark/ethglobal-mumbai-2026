/**
 * Agent-defined submission forms (Google-Forms-like) for gigs.
 * Validated with zod; max 20 fields.
 */

import { z } from "zod";

export const SUBMISSION_FIELD_TYPES = [
  "short_text",
  "long_text",
  "number",
  "select",
  "multi_select",
  "checkbox",
  "date",
  "image",
  "file",
  "location",
  "url",
] as const;

export type SubmissionFieldType = (typeof SUBMISSION_FIELD_TYPES)[number];

export type SubmissionFormField = {
  id: string;
  label: string;
  type: SubmissionFieldType;
  required?: boolean;
  options?: string[];
  min?: number;
  max?: number;
  help?: string;
};

export type SubmissionForm = {
  fields: SubmissionFormField[];
};

export type FormAttachmentRef = {
  attachmentId: string;
  filename?: string;
  contentType?: string;
};

export type FormLocationValue = { lat: number; lng: number };

export type FormFieldValue =
  | string
  | number
  | boolean
  | string[]
  | FormLocationValue
  | FormAttachmentRef;

/** Worker response keyed by field id. */
export type FormResponse = Record<string, FormFieldValue>;

export type FormCardRow = {
  id: string;
  label: string;
  type: SubmissionFieldType;
  value: FormFieldValue;
};

const fieldIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-zA-Z][a-zA-Z0-9_]*$/,
    "field id must be alphanumeric/underscore starting with a letter",
  );

export const submissionFormFieldSchema = z
  .object({
    id: fieldIdSchema,
    label: z.string().min(1).max(120),
    type: z.enum(SUBMISSION_FIELD_TYPES),
    required: z.boolean().optional(),
    options: z.array(z.string().min(1).max(80)).max(50).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    help: z.string().max(280).optional(),
  })
  .superRefine((f, ctx) => {
    if (
      (f.type === "select" || f.type === "multi_select") &&
      (!f.options || f.options.length < 1)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${f.type} field "${f.id}" requires options`,
        path: ["options"],
      });
    }
    if (
      f.min != null &&
      f.max != null &&
      Number.isFinite(f.min) &&
      Number.isFinite(f.max) &&
      f.min > f.max
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `field "${f.id}" min > max`,
        path: ["min"],
      });
    }
  });

export const submissionFormSchema = z.object({
  fields: z
    .array(submissionFormFieldSchema)
    .min(1)
    .max(20)
    .superRefine((fields, ctx) => {
      const seen = new Set<string>();
      for (const f of fields) {
        if (seen.has(f.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `duplicate field id "${f.id}"`,
          });
        }
        seen.add(f.id);
      }
    }),
});

/** Example form for agent tool descriptions. */
export const EXAMPLE_SUBMISSION_FORM: SubmissionForm = {
  fields: [
    {
      id: "store_name",
      label: "Store name",
      type: "short_text",
      required: true,
      help: "As printed on the facade",
    },
    {
      id: "shelf_photo",
      label: "Shelf photo",
      type: "image",
      required: true,
    },
    {
      id: "sku_count",
      label: "Facing count",
      type: "number",
      required: true,
      min: 0,
      max: 500,
    },
    {
      id: "condition",
      label: "Shelf condition",
      type: "select",
      required: true,
      options: ["clean", "messy", "out_of_stock"],
    },
    {
      id: "notes",
      label: "Notes",
      type: "long_text",
      required: false,
    },
    {
      id: "check_in",
      label: "Check-in location",
      type: "location",
      required: true,
    },
  ],
};

export function parseSubmissionForm(raw: unknown): SubmissionForm {
  return submissionFormSchema.parse(raw);
}

export function safeParseSubmissionForm(raw: unknown) {
  return submissionFormSchema.safeParse(raw);
}

function isEmpty(v: FormFieldValue | undefined | null): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function asAttachmentRef(v: FormFieldValue): FormAttachmentRef | null {
  if (typeof v === "string" && v.trim()) {
    return { attachmentId: v.trim() };
  }
  if (
    v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    "attachmentId" in v &&
    typeof (v as FormAttachmentRef).attachmentId === "string"
  ) {
    return v as FormAttachmentRef;
  }
  return null;
}

export type FormResponseValidation =
  | { ok: true; response: FormResponse; card: FormCardRow[] }
  | { ok: false; error: string };

/** Validate a worker form_response against the gig's submission_form. */
export function validateFormResponse(
  form: SubmissionForm,
  raw: unknown,
): FormResponseValidation {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "form_response must be an object" };
  }
  const input = raw as Record<string, unknown>;
  const known = new Set(form.fields.map((f) => f.id));
  for (const key of Object.keys(input)) {
    if (!known.has(key)) {
      return { ok: false, error: `unknown form field "${key}"` };
    }
  }

  const response: FormResponse = {};
  const card: FormCardRow[] = [];

  for (const field of form.fields) {
    const v = input[field.id] as FormFieldValue | undefined;
    if (field.required && isEmpty(v as FormFieldValue)) {
      return {
        ok: false,
        error: `required field "${field.id}" (${field.label}) is missing`,
      };
    }
    if (v == null || isEmpty(v)) continue;

    try {
      const coerced = coerceFieldValue(field, v);
      response[field.id] = coerced;
      card.push({
        id: field.id,
        label: field.label,
        type: field.type,
        value: coerced,
      });
    } catch (e) {
      return {
        ok: false,
        error:
          e instanceof Error
            ? e.message
            : `invalid value for field "${field.id}"`,
      };
    }
  }

  return { ok: true, response, card };
}

function coerceFieldValue(
  field: SubmissionFormField,
  v: FormFieldValue,
): FormFieldValue {
  switch (field.type) {
    case "short_text":
    case "long_text":
    case "date":
    case "url": {
      if (typeof v !== "string") {
        throw new Error(`field "${field.id}" expects a string`);
      }
      const s = v.trim();
      if (field.type === "short_text" && s.length > 200) {
        throw new Error(`field "${field.id}" max 200 chars`);
      }
      if (field.type === "long_text" && s.length > 4000) {
        throw new Error(`field "${field.id}" max 4000 chars`);
      }
      if (field.type === "url") {
        try {
          const u = new URL(s);
          if (u.protocol !== "http:" && u.protocol !== "https:") {
            throw new Error("bad protocol");
          }
        } catch {
          throw new Error(`field "${field.id}" expects an http(s) url`);
        }
      }
      if (field.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        throw new Error(`field "${field.id}" expects YYYY-MM-DD`);
      }
      return s;
    }
    case "number": {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) {
        throw new Error(`field "${field.id}" expects a number`);
      }
      if (field.min != null && n < field.min) {
        throw new Error(`field "${field.id}" below min ${field.min}`);
      }
      if (field.max != null && n > field.max) {
        throw new Error(`field "${field.id}" above max ${field.max}`);
      }
      return n;
    }
    case "checkbox": {
      if (typeof v !== "boolean") {
        throw new Error(`field "${field.id}" expects a boolean`);
      }
      return v;
    }
    case "select": {
      if (typeof v !== "string") {
        throw new Error(`field "${field.id}" expects a string option`);
      }
      if (!field.options?.includes(v)) {
        throw new Error(`field "${field.id}" invalid option`);
      }
      return v;
    }
    case "multi_select": {
      const arr = Array.isArray(v) ? v : [v];
      if (!arr.every((x) => typeof x === "string")) {
        throw new Error(`field "${field.id}" expects string options`);
      }
      for (const x of arr) {
        if (!field.options?.includes(x)) {
          throw new Error(`field "${field.id}" invalid option "${x}"`);
        }
      }
      return arr as string[];
    }
    case "image":
    case "file": {
      const ref = asAttachmentRef(v);
      if (!ref?.attachmentId) {
        throw new Error(
          `field "${field.id}" expects attachmentId (upload first)`,
        );
      }
      return {
        attachmentId: ref.attachmentId,
        filename: ref.filename,
        contentType: ref.contentType,
      };
    }
    case "location": {
      if (
        !v ||
        typeof v !== "object" ||
        Array.isArray(v) ||
        typeof (v as FormLocationValue).lat !== "number" ||
        typeof (v as FormLocationValue).lng !== "number"
      ) {
        throw new Error(`field "${field.id}" expects {lat, lng}`);
      }
      const { lat, lng } = v as FormLocationValue;
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
      ) {
        throw new Error(`field "${field.id}" lat/lng out of range`);
      }
      return { lat, lng };
    }
    default:
      throw new Error(`unsupported field type`);
  }
}

/** Plain-text body for the thread when a form is submitted. */
export function formatFormCardBody(card: FormCardRow[]): string {
  const lines = card.map((row) => {
    let display: string;
    if (
      row.value &&
      typeof row.value === "object" &&
      !Array.isArray(row.value)
    ) {
      if ("attachmentId" in row.value) {
        display = `[attachment ${row.value.attachmentId}]`;
      } else if ("lat" in row.value) {
        display = `${row.value.lat.toFixed(5)}, ${row.value.lng.toFixed(5)}`;
      } else {
        display = JSON.stringify(row.value);
      }
    } else if (Array.isArray(row.value)) {
      display = row.value.join(", ");
    } else if (typeof row.value === "boolean") {
      display = row.value ? "yes" : "no";
    } else {
      display = String(row.value);
    }
    return `${row.label}: ${display}`;
  });
  return lines.join("\n") || "Form submitted";
}
