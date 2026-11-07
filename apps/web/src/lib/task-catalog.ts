import type { EscrowTask } from "@proofwork/shared/browser";

export type TaskMeta = {
  title: string;
  place: string;
  neighborhood: string;
  instructions: string;
};

function shortRef(cid: string): string {
  if (cid.length <= 20) return cid;
  return `${cid.slice(0, 10)}…${cid.slice(-6)}`;
}

/** Display labels from escrow task fields — no demo catalog. */
export function getTaskMeta(
  task: Pick<
    EscrowTask,
    "title" | "metadataCid" | "category" | "geo" | "tags" | "posterAgent"
  >,
): TaskMeta {
  const title = task.title?.trim() || shortRef(task.metadataCid);
  const place = task.geo
    ? `${task.geo.lat.toFixed(3)}, ${task.geo.lng.toFixed(3)}`
    : "No location";
  const neighborhood =
    task.category?.trim() ||
    (task.tags?.length ? task.tags[0]! : "Gig");
  const instructions = task.title?.trim()
    ? `${task.title.trim()} — follow the agent thread for details.`
    : `Gig ${shortRef(task.metadataCid)} — check the task thread for instructions.`;
  return { title, place, neighborhood, instructions };
}
