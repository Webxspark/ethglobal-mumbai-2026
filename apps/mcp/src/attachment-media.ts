/**
 * Agent-facing attachment decoding — HEIC→JPEG and plain-text extraction.
 */

import sharp from "sharp";

export function isImageMime(mime: string, filename?: string): boolean {
  const ct = mime.toLowerCase();
  if (ct.startsWith("image/")) return true;
  if (/\.(png|jpe?g|gif|webp|heic|heif)$/i.test(filename ?? "")) return true;
  return false;
}

export type PreparedBytes = {
  bytes: Buffer;
  contentType: string;
  convertedFrom?: string;
};

/** Normalize image bytes for vision models (HEIC/HEIF → JPEG). */
export async function prepareAttachmentBytes(
  meta: { contentType: string; filename: string },
  bytes: Buffer,
): Promise<PreparedBytes> {
  const ct = meta.contentType.toLowerCase();
  const heic =
    ct.includes("heic") ||
    ct.includes("heif") ||
    /\.heic$/i.test(meta.filename) ||
    /\.heif$/i.test(meta.filename);
  if (heic) {
    const out = await sharp(bytes).jpeg({ quality: 90 }).toBuffer();
    return { bytes: out, contentType: "image/jpeg", convertedFrom: "heic" };
  }
  return { bytes, contentType: meta.contentType };
}

const TEXT_MIMES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

/** Best-effort UTF-8 extraction for document-like attachments. */
export function extractDocumentText(
  contentType: string,
  bytes: Buffer,
): string | null {
  const ct = contentType.toLowerCase().split(";")[0]!.trim();
  if (!ct.startsWith("text/") && !TEXT_MIMES.has(ct)) return null;
  const s = bytes.toString("utf8");
  if (!s.trim()) return null;
  const max = 32_000;
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…[truncated at ${max} chars]`;
}
