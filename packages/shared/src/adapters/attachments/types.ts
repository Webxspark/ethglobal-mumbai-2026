import type { ThreadAttachment } from "../../types.js";

export type PutAttachmentInput = {
  filename: string;
  contentType?: string;
  /** Raw bytes, or base64 / data-URL string. */
  data: Buffer | string;
  /** Fetch remote URL into the store (http/https only). */
  url?: string;
};

export type AttachmentRecord = ThreadAttachment & {
  absolutePath: string;
  sha256: string;
};

export type AttachmentStore = {
  put(i: PutAttachmentInput): Promise<AttachmentRecord>;
  get(id: string): Promise<{ meta: AttachmentRecord; bytes: Buffer }>;
  meta(id: string): Promise<AttachmentRecord | null>;
  rootDir: string;
};
