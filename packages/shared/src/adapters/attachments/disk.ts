import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AttachmentRecord,
  AttachmentStore,
  PutAttachmentInput,
} from "./types.js";

export type {
  AttachmentRecord,
  AttachmentStore,
  PutAttachmentInput,
} from "./types.js";

function sniffType(filename: string, hinted?: string): string {
  if (hinted && hinted.includes("/")) return hinted;
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".txt") return "text/plain";
  if (ext === ".json") return "application/json";
  return hinted || "application/octet-stream";
}

function decodeData(data: Buffer | string): Buffer {
  if (Buffer.isBuffer(data)) return data;
  const s = data.trim();
  const dataUrl = /^data:([^;]+);base64,(.+)$/i.exec(s);
  if (dataUrl) return Buffer.from(dataUrl[2]!, "base64");
  // bare base64 — prefer when padded length looks right
  const compact = s.replace(/\s+/g, "");
  if (
    /^[A-Za-z0-9+/=]+$/.test(compact) &&
    compact.length >= 8 &&
    compact.length % 4 === 0
  ) {
    const decoded = Buffer.from(compact, "base64");
    // round-trip check so plain words like "note.txt" don't get mangled
    if (decoded.byteLength > 0 && decoded.toString("base64").replace(/=+$/, "") === compact.replace(/=+$/, "")) {
      return decoded;
    }
  }
  return Buffer.from(s, "utf8");
}

function safeName(name: string): string {
  const base = path.basename(name || "upload.bin").replace(/[^\w.\-]+/g, "_");
  return base.slice(0, 120) || "upload.bin";
}

/**
 * Local disk attachment store (S3-compatible swap later via same interface).
 * Files land under rootDir/<id>/<filename>.
 */
export function createDiskAttachmentStore(
  rootDir: string,
  opts: { fetchImpl?: typeof fetch; maxBytes?: number } = {},
): AttachmentStore {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  const maxBytes = opts.maxBytes ?? 8 * 1024 * 1024;
  const index = new Map<string, AttachmentRecord>();

  async function ensureRoot() {
    await mkdir(rootDir, { recursive: true });
  }

  return {
    rootDir,

    async put(i) {
      await ensureRoot();
      let bytes: Buffer;
      let filename = safeName(i.filename || "upload.bin");
      let contentType = sniffType(filename, i.contentType);

      if (i.url) {
        const u = i.url.trim();
        if (!/^https?:\/\//i.test(u)) {
          throw new Error("attachment url must be http(s)");
        }
        if (!fetchImpl) throw new Error("no fetch available for attachment url");
        const res = await fetchImpl(u, { signal: AbortSignal.timeout(12_000) });
        if (!res.ok) throw new Error(`attachment url fetch ${res.status}`);
        const ab = await res.arrayBuffer();
        bytes = Buffer.from(ab);
        const ct = res.headers.get("content-type");
        if (ct) contentType = ct.split(";")[0]!.trim() || contentType;
        if (!i.filename) {
          const last = u.split("/").pop() || "remote.bin";
          filename = safeName(last.split("?")[0] || "remote.bin");
        }
      } else if (i.data != null) {
        bytes = decodeData(i.data);
      } else {
        throw new Error("attachment requires data or url");
      }

      if (bytes.byteLength > maxBytes) {
        throw new Error(`attachment too large (max ${maxBytes} bytes)`);
      }
      if (bytes.byteLength === 0) throw new Error("empty attachment");

      const sha256 = createHash("sha256").update(bytes).digest("hex");
      // Content-addressed id — message/evidence refs + get_attachment share this key.
      const id = `att_${sha256}`;
      const dir = path.join(rootDir, id);
      await mkdir(dir, { recursive: true });
      const abs = path.join(dir, filename);
      await writeFile(abs, bytes);

      const meta: AttachmentRecord = {
        id,
        filename,
        contentType,
        size: bytes.byteLength,
        storeKey: path.join(id, filename),
        absolutePath: abs,
        sha256,
      };
      index.set(id, meta);
      await writeFile(
        path.join(dir, "meta.json"),
        JSON.stringify({
          id,
          filename,
          contentType,
          size: meta.size,
          storeKey: meta.storeKey,
          sha256,
        }),
      );
      return meta;
    },

    async meta(id) {
      const hit = index.get(id);
      if (hit) return hit;
      try {
        const raw = await readFile(path.join(rootDir, id, "meta.json"), "utf8");
        const j = JSON.parse(raw) as Omit<AttachmentRecord, "absolutePath">;
        const rec: AttachmentRecord = {
          ...j,
          absolutePath: path.join(rootDir, id, j.filename),
        };
        index.set(id, rec);
        return rec;
      } catch {
        return null;
      }
    },

    async get(id) {
      const meta = await this.meta(id);
      if (!meta) throw new Error(`unknown attachment ${id}`);
      const bytes = await readFile(meta.absolutePath);
      return { meta, bytes };
    },
  };
}
