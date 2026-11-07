import { EscrowStatus, type EscrowTask, type Wei } from "@proofwork/shared/browser";
import { sortTasks } from "@proofwork/shared/browser";

export type GigSort = "newest" | "reward_desc" | "reward_asc" | "deadline_asc";

export type GigBoardFilters = {
  status: string;
  rewardMin: string;
  rewardMax: string;
  category: string;
  tags: string;
  deadlineBefore: string;
  poster: string;
  q: string;
  sort: GigSort;
};

export const DEFAULT_GIG_FILTERS: GigBoardFilters = {
  status: "OPEN",
  rewardMin: "",
  rewardMax: "",
  category: "",
  tags: "",
  deadlineBefore: "",
  poster: "",
  q: "",
  sort: "newest",
};

const SORTS = new Set<GigSort>([
  "newest",
  "reward_desc",
  "reward_asc",
  "deadline_asc",
]);

export function parseGigFilters(
  params: URLSearchParams | { get(name: string): string | null },
): GigBoardFilters {
  const sortRaw = params.get("sort") ?? "newest";
  return {
    status: params.get("status") ?? DEFAULT_GIG_FILTERS.status,
    rewardMin: params.get("rmin") ?? "",
    rewardMax: params.get("rmax") ?? "",
    category: params.get("cat") ?? "",
    tags: params.get("tags") ?? "",
    deadlineBefore: params.get("before") ?? "",
    poster: params.get("poster") ?? "",
    q: params.get("q") ?? "",
    sort: SORTS.has(sortRaw as GigSort) ? (sortRaw as GigSort) : "newest",
  };
}

export function gigFiltersToParams(f: GigBoardFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.status && f.status !== "ALL") p.set("status", f.status);
  if (f.rewardMin.trim()) p.set("rmin", f.rewardMin.trim());
  if (f.rewardMax.trim()) p.set("rmax", f.rewardMax.trim());
  if (f.category.trim()) p.set("cat", f.category.trim());
  if (f.tags.trim()) p.set("tags", f.tags.trim());
  if (f.deadlineBefore.trim()) p.set("before", f.deadlineBefore.trim());
  if (f.poster.trim()) p.set("poster", f.poster.trim());
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.sort !== "newest") p.set("sort", f.sort);
  return p;
}

function parseUsd(raw: string): number | null {
  const n = Number.parseFloat(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Client-side filter over mirrored tasks (mock + mcp live store). */
export function filterGigBoard(
  tasks: EscrowTask[],
  f: GigBoardFilters,
  weiPerUnit: bigint,
): EscrowTask[] {
  let rows = [...tasks];

  if (f.status && f.status !== "ALL") {
    const wanted = f.status
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    rows = rows.filter((t) => wanted.includes(t.status));
  }

  const minUsd = parseUsd(f.rewardMin);
  const maxUsd = parseUsd(f.rewardMax);
  if (minUsd != null) {
    const minWei = BigInt(Math.round(minUsd * Number(weiPerUnit))) as Wei;
    rows = rows.filter((t) => t.rewardWei >= minWei);
  }
  if (maxUsd != null) {
    const maxWei = BigInt(Math.round(maxUsd * Number(weiPerUnit))) as Wei;
    rows = rows.filter((t) => t.rewardWei <= maxWei);
  }

  if (f.category.trim()) {
    const cat = f.category.trim().toLowerCase();
    rows = rows.filter((t) => (t.category ?? "").toLowerCase() === cat);
  }

  if (f.tags.trim()) {
    const need = f.tags
      .split(/[, ]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    rows = rows.filter((t) => {
      const have = new Set((t.tags ?? []).map((x) => x.toLowerCase()));
      return need.every((n) => have.has(n));
    });
  }

  if (f.deadlineBefore.trim()) {
    const raw = f.deadlineBefore.trim();
    let before: number | null = null;
    if (/^\d+$/.test(raw)) before = Number(raw);
    else {
      const ms = Date.parse(raw);
      if (!Number.isNaN(ms)) before = Math.floor(ms / 1000);
    }
    if (before != null) {
      rows = rows.filter((t) => {
        const dl = t.deadlineAt ?? t.expiresAt;
        return dl != null && dl <= before!;
      });
    }
  }

  if (f.poster.trim()) {
    const needle = f.poster.trim().toLowerCase();
    rows = rows.filter((t) =>
      (t.posterAgent ?? t.owner).toLowerCase().includes(needle),
    );
  }

  if (f.q.trim()) {
    const needle = f.q.trim().toLowerCase();
    rows = rows.filter((t) =>
      [t.title, t.metadataCid, t.category, t.posterAgent, ...(t.tags ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }

  return sortTasks(rows, f.sort);
}

export const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "OPEN", label: "Open" },
  { value: "ACCEPTED", label: "Claimed" },
  { value: "SUBMITTED", label: "In review" },
  { value: "PAID", label: "Paid" },
  { value: "EXPIRED", label: "Expired" },
  { value: "ALL", label: "All" },
];

export const SORT_OPTIONS: { value: GigSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "reward_desc", label: "Reward ↓" },
  { value: "reward_asc", label: "Reward ↑" },
  { value: "deadline_asc", label: "Deadline" },
];

export function categoryFromTask(task: EscrowTask): string {
  return task.category ?? "";
}

/** Keep enum import used for typecheck consumers. */
export const OPEN = EscrowStatus.Open;
