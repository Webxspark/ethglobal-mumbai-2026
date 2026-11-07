/**
 * Load monorepo-root `.env` into process.env without clobbering exports.
 * Next still needs apps/web/.env.local for NEXT_PUBLIC_*.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function stripQuotes(v: string): string {
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

/** Resolve repo root from a file under apps/mcp/src (…/apps/mcp/src → …/). */
export function monorepoRoot(fromImportMetaUrl: string): string {
  return path.resolve(path.dirname(fileURLToPath(fromImportMetaUrl)), "../../..");
}

/**
 * Parse KEY=VALUE lines. Skips blanks, `#` comments, and keys already set
 * on `target` (so shell exports win).
 */
export function applyEnvFile(
  contents: string,
  target: Record<string, string | undefined> = process.env,
): string[] {
  const applied: string[] = [];
  for (const raw of contents.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (target[key] !== undefined) continue;
    const value = stripQuotes(line.slice(eq + 1).trim());
    target[key] = value;
    applied.push(key);
  }
  return applied;
}

/** Side-effect load for MCP HTTP / stdio entrypoints. */
export function loadRootEnv(fromImportMetaUrl: string = import.meta.url): {
  path: string;
  loaded: boolean;
  keys: string[];
} {
  const envPath = path.join(monorepoRoot(fromImportMetaUrl), ".env");
  if (!fs.existsSync(envPath)) {
    return { path: envPath, loaded: false, keys: [] };
  }
  const keys = applyEnvFile(fs.readFileSync(envPath, "utf8"));
  return { path: envPath, loaded: true, keys };
}
