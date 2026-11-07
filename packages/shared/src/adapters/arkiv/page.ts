import { MAX_LIMIT } from "@arkiv-network/sdk/query";

/** Max TaskFeed rows to pull per nearby/discovery query (deduped). */
export const ARKIV_FETCH_CAP = 500;

export type ArkivQueryPage<T> = {
  entities: readonly T[];
  skipped: number;
};

/** Client-side guard — matches the Arkiv SDK / node page-size rules. */
export function assertArkivLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`limit must be a positive integer, got ${limit}.`);
  }
  if (limit > MAX_LIMIT) {
    throw new Error(
      `limit ${limit} exceeds the node maximum of ${MAX_LIMIT}. Page through the results with ` +
        "an offset instead.",
    );
  }
}

/**
 * Walk Arkiv query pages with limit ≤ {@link MAX_LIMIT} until the node is done
 * or `maxEntities` unique rows are collected.
 */
export async function mergeArkivPages<T>(
  fetchPage: (limit: number, offset: number) => Promise<ArkivQueryPage<T>>,
  opts: {
    pageSize?: number;
    maxEntities?: number;
    dedupeKey?: (row: T) => string | undefined;
  } = {},
): Promise<T[]> {
  const pageSize = Math.min(opts.pageSize ?? MAX_LIMIT, MAX_LIMIT);
  assertArkivLimit(pageSize);

  const maxEntities = opts.maxEntities ?? ARKIV_FETCH_CAP;
  const keyOf = opts.dedupeKey;
  const seen = keyOf ? new Set<string>() : undefined;
  const merged: T[] = [];
  let offset = 0;

  while (merged.length < maxEntities) {
    const take = Math.min(pageSize, maxEntities - merged.length);
    assertArkivLimit(take);

    const page = await fetchPage(take, offset);
    for (const row of page.entities) {
      if (keyOf) {
        const k = keyOf(row);
        if (!k) continue;
        if (seen!.has(k)) continue;
        seen!.add(k);
      }
      merged.push(row);
      if (merged.length >= maxEntities) break;
    }

    const covered = page.entities.length + page.skipped;
    if (covered < take) break;
    offset += covered;
  }

  return merged;
}
