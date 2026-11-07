import {
  createPublicClient,
  createWalletClient,
  ExpirationTime,
} from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { and, asc, eq, gte, lte, MAX_LIMIT } from "@arkiv-network/sdk/query";
import { mergeArkivPages } from "./page.js";
import { dec, defineSchema, str, u64 } from "@arkiv-network/sdk/schema";
import { http, isHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ArkivPort } from "../../ports/index.js";
import { haversineMeters } from "../../taskQuery.js";
import type { EscrowTask, TaskId, UnixSecs } from "../../types.js";

/** Named schema so nearby queries only see Proofwork TaskFeed rows. */
export const TaskFeed = defineSchema("proofwork.taskfeed", {
  taskId: str().indexed(),
  lat: dec().indexed(),
  lng: dec().indexed(),
  potId: str().indexed(),
  expiresAt: u64().indexed(),
});

/** Pull access key from `/ark_…` path segment when the full RPC URL is given. */
export function accessKeyFromRpcUrl(rpcUrl: string): string {
  try {
    const u = new URL(rpcUrl);
    const seg = u.pathname.split("/").filter(Boolean);
    const key = seg.find((s) => s.startsWith("ark_")) ?? seg[seg.length - 1];
    return key && key.startsWith("ark_") ? key : "";
  } catch {
    return "";
  }
}

function entityExpiresAt(task: EscrowTask): UnixSecs {
  return (task.verifyDeadline ??
    task.expiresAt ??
    ((task.createdAt + 86_400) as UnixSecs)) as UnixSecs;
}

function bbox(q: { lat: number; lng: number; radiusM: number }) {
  const latDelta = q.radiusM / 111_320;
  const cos = Math.cos((q.lat * Math.PI) / 180);
  const lngDelta = q.radiusM / (111_320 * Math.max(0.2, Math.abs(cos)));
  return {
    minLat: q.lat - latDelta,
    maxLat: q.lat + latDelta,
    minLng: q.lng - lngDelta,
    maxLng: q.lng + lngDelta,
  };
}

/** Live write/read budget — Rabdi RPC sometimes stalls without rejecting. */
export const ARKIV_LIVE_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Live Arkiv (Rabdi) TaskFeed adapter.
 * Reads need ARKIV_RPC_URL only; writes need ARKIV_PRIVATE_KEY (funded tGLM).
 */
export function createLiveArkiv(env: {
  rpcUrl: string;
  privateKey?: string;
  /** Override write/query timeout (ms). */
  timeoutMs?: number;
}): ArkivPort {
  const timeoutMs = env.timeoutMs ?? ARKIV_LIVE_TIMEOUT_MS;
  const accessKey = accessKeyFromRpcUrl(env.rpcUrl);
  const chain = rabdi({ accessKey });
  const transport = http(env.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });

  const pk = env.privateKey?.trim();
  const account =
    pk && isHex(pk) ? privateKeyToAccount(pk as Hex) : undefined;
  const walletClient = account
    ? createWalletClient({ chain, transport, account })
    : undefined;

  // Session cache: taskId → entity key (survives across upserts in one MCP process).
  const keys = new Map<string, Hex>();

  async function findKey(taskId: string): Promise<Hex | undefined> {
    const cached = keys.get(taskId);
    if (cached) return cached;
    const result = await withTimeout(
      publicClient
        .select({ $key: true, taskId: true })
        .from(TaskFeed)
        .where(eq("taskId", taskId))
        .limit(1)
        .fetch(),
      timeoutMs,
      `arkiv findKey ${taskId}`,
    );
    const row = result.entities[0];
    if (!row?.$key) return undefined;
    keys.set(taskId, row.$key);
    return row.$key;
  }

  function requireWallet() {
    if (!walletClient || !account) {
      throw new Error(
        "ARKIV_PRIVATE_KEY required for Arkiv writes (reads work with ARKIV_RPC_URL only)",
      );
    }
    return { walletClient, account };
  }

  return {
    async upsertTaskEntity(task: EscrowTask) {
      return withTimeout(
        (async () => {
          // Drop from nearby: delete on-chain entity when geo is cleared.
          if (!task.geo) {
            const { walletClient: w } = requireWallet();
            const existing = await findKey(task.id);
            if (!existing) return;
            await w.deleteEntity({ entityKey: existing });
            keys.delete(task.id);
            return;
          }

          const { walletClient: w } = requireWallet();
          const expiresAt = entityExpiresAt(task);
          const values = {
            taskId: task.id,
            lat: dec(String(task.geo.lat)),
            lng: dec(String(task.geo.lng)),
            potId: task.potId,
            expiresAt: u64(expiresAt),
          };
          const expiration = ExpirationTime.atDate(new Date(expiresAt * 1000), {
            atLeast: ExpirationTime.fromHours(1),
          });

          const existing = await findKey(task.id);
          if (existing) {
            await w.patchEntity(TaskFeed, existing, { set: values });
            await w.extendEntity({ entityKey: existing, expiration });
            return;
          }

          const { entityKey } = await w.createEntity(TaskFeed, values, {
            expiration,
          });
          keys.set(task.id, entityKey);
        })(),
        timeoutMs,
        `arkiv upsert ${task.id}`,
      );
    },

    async nearby(q): Promise<TaskId[]> {
      return withTimeout(
        (async () => {
          const box = bbox(q);
          const now = Math.floor(Date.now() / 1000);
          // Bounding-box prefilter (indexed lat/lng); exact distance client-side.
          type FeedRow = {
            $key?: { value?: Hex };
            taskId?: { value?: string };
            lat?: { value?: string };
            lng?: { value?: string };
            expiresAt?: { value?: bigint };
          };

          const rows = await mergeArkivPages<FeedRow>(
            async (limit, offset) => {
              const result = await publicClient
                .select({
                  $key: true,
                  taskId: true,
                  lat: true,
                  lng: true,
                  expiresAt: true,
                })
                .from(TaskFeed)
                .where(
                  and(
                    gte("lat", dec(String(box.minLat))),
                    lte("lat", dec(String(box.maxLat))),
                    gte("lng", dec(String(box.minLng))),
                    lte("lng", dec(String(box.maxLng))),
                  ),
                )
                .orderBy(asc("$key"))
                .limit(limit)
                .offset(offset)
                .fetch();
              return {
                entities: result.entities as readonly FeedRow[],
                skipped: result.skipped,
              };
            },
            {
              pageSize: MAX_LIMIT,
              dedupeKey: (row) => (row.taskId?.value as string | undefined) ?? undefined,
            },
          );

          const hits: { id: TaskId; d: number }[] = [];
          for (const row of rows) {
            const expires = Number(row.expiresAt?.value ?? 0);
            if (expires > 0 && expires < now) continue;
            const lat = Number(row.lat?.value ?? NaN);
            const lng = Number(row.lng?.value ?? NaN);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
            const d = haversineMeters(
              { lat, lng },
              { lat: q.lat, lng: q.lng },
            );
            if (d > q.radiusM) continue;
            const id = (row.taskId?.value ?? "") as TaskId;
            if (!id) continue;
            if (row.$key?.value) keys.set(id, row.$key.value);
            hits.push({ id, d });
          }
          hits.sort((a, b) => a.d - b.d);
          return hits.map((h) => h.id);
        })(),
        timeoutMs,
        "arkiv nearby",
      );
    },
  };
}
