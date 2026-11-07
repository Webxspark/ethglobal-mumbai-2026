import type { ArkivPort } from "../../ports/index.js";
import { haversineMeters } from "../../taskQuery.js";
import type {
  EscrowTask,
  PotId,
  TaskId,
  UnixSecs,
} from "../../types.js";

export type FeedEntity = {
  taskId: TaskId;
  lat: number;
  lng: number;
  potId: PotId;
  expiresAt: UnixSecs;
};

export type ArkivBundle = ArkivPort & {
  /** Debug/demo: inspect feed entities (mock only). */
  snapshot(): readonly FeedEntity[];
};

export function createMockArkiv(
  clock: () => UnixSecs = () => Math.floor(Date.now() / 1000) as UnixSecs,
): ArkivBundle {
  const entities = new Map<string, FeedEntity>();

  return {
    async upsertTaskEntity(task: EscrowTask) {
      if (!task.geo) {
        entities.delete(task.id);
        return;
      }
      const expiresAt = (task.verifyDeadline ??
        ((task.createdAt + 86_400) as UnixSecs)) as UnixSecs;
      entities.set(task.id, {
        taskId: task.id,
        lat: task.geo.lat,
        lng: task.geo.lng,
        potId: task.potId,
        expiresAt,
      });
    },

    async nearby(q) {
      const now = clock();
      const hits: { id: TaskId; d: number }[] = [];
      for (const e of entities.values()) {
        if (e.expiresAt < now) continue;
        const d = haversineMeters(
          { lat: e.lat, lng: e.lng },
          { lat: q.lat, lng: q.lng },
        );
        if (d <= q.radiusM) hits.push({ id: e.taskId, d });
      }
      hits.sort((a, b) => a.d - b.d);
      return hits.map((h) => h.id);
    },

    snapshot() {
      return [...entities.values()];
    },
  };
}
