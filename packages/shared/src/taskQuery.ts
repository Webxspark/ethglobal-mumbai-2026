import type { EscrowTask, TaskQuery } from "./types.js";

export function matchesTaskQuery(
  task: EscrowTask,
  q: Omit<TaskQuery, "near" | "sort">,
): boolean {
  if (q.potId && task.potId !== q.potId) return false;
  if (q.status && q.status.length > 0 && !q.status.includes(task.status)) {
    return false;
  }
  if (q.rewardMinWei != null && task.rewardWei < q.rewardMinWei) return false;
  if (q.rewardMaxWei != null && task.rewardWei > q.rewardMaxWei) return false;
  if (q.category) {
    const cat = (task.category ?? "").toLowerCase();
    if (cat !== q.category.toLowerCase()) return false;
  }
  if (q.tags && q.tags.length > 0) {
    const have = new Set((task.tags ?? []).map((t) => t.toLowerCase()));
    for (const tag of q.tags) {
      if (!have.has(tag.toLowerCase())) return false;
    }
  }
  if (q.deadlineBefore != null) {
    const dl = task.deadlineAt ?? task.expiresAt ?? null;
    if (dl == null || dl > q.deadlineBefore) return false;
  }
  if (q.posterAgent) {
    const poster = (task.posterAgent ?? task.owner ?? "").toLowerCase();
    if (!poster.includes(q.posterAgent.toLowerCase())) return false;
  }
  if (q.search && q.search.trim()) {
    const needle = q.search.trim().toLowerCase();
    const hay = [
      task.title ?? "",
      task.metadataCid ?? "",
      task.category ?? "",
      ...(task.tags ?? []),
      task.posterAgent ?? "",
    ]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}

export function sortTasks(
  rows: EscrowTask[],
  sort: TaskQuery["sort"] = "newest",
): EscrowTask[] {
  const out = [...rows];
  out.sort((a, b) => {
    if (sort === "reward_desc") {
      if (a.rewardWei === b.rewardWei) return b.createdAt - a.createdAt;
      return a.rewardWei < b.rewardWei ? 1 : -1;
    }
    if (sort === "reward_asc") {
      if (a.rewardWei === b.rewardWei) return b.createdAt - a.createdAt;
      return a.rewardWei > b.rewardWei ? 1 : -1;
    }
    if (sort === "deadline_asc") {
      const da = a.deadlineAt ?? a.expiresAt ?? Number.MAX_SAFE_INTEGER;
      const db = b.deadlineAt ?? b.expiresAt ?? Number.MAX_SAFE_INTEGER;
      if (da === db) return b.createdAt - a.createdAt;
      return da - db;
    }
    // newest
    return b.createdAt - a.createdAt;
  });
  return out;
}

/** Haversine distance in meters. */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
