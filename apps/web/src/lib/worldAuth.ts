import { createWorldAuth, type WorldAuthBundle } from "@proofwork/shared";

let cached: WorldAuthBundle | null = null;

/** Server-only composition root for World Agent Pass + IDKit. */
export function getWorldAuth(): WorldAuthBundle {
  if (!cached) {
    cached = createWorldAuth(process.env);
  }
  return cached;
}

export function resetWorldAuthForTests(): void {
  cached = null;
}
