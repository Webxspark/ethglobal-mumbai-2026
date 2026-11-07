"use client";

import {
  fetchHonestyStatus,
  type HonestyStatus,
} from "@/lib/honesty";

/** Session-scoped honesty/IDKit key check — one network hit until hard reset. */
let honestyCache: HonestyStatus | null = null;
let honestyInflight: Promise<HonestyStatus> | null = null;

export async function getSessionHonesty(
  opts?: { force?: boolean },
): Promise<HonestyStatus> {
  if (!opts?.force && honestyCache) return honestyCache;
  if (!opts?.force && honestyInflight) return honestyInflight;
  honestyInflight = fetchHonestyStatus()
    .then((h) => {
      honestyCache = h;
      return h;
    })
    .finally(() => {
      honestyInflight = null;
    });
  return honestyInflight;
}

export function clearSessionHonesty() {
  honestyCache = null;
}
