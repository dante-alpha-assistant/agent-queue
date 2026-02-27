import { QueueClient } from "./client.js";
import { type Task, deserializeTask, serializeTask } from "./schemas.js";
import { STREAMS, CONSUMER_GROUP } from "./streams.js";

const DEFAULT_IDLE_MS = 60_000;
const DEFAULT_INTERVAL_MS = 30_000;
const RECLAIMER = "reclaimer";

export class ReliabilityManager {
  private client: QueueClient;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(client: QueueClient) {
    this.client = client;
  }

  async reclaimStale(): Promise<number> {
    const redis = this.client.getRedis();
    const pending: [string, string, number, number][] = await redis.xpending(
      STREAMS.TASKS, CONSUMER_GROUP, "-", "+", 100,
    ) as any;

    let reclaimed = 0;

    for (const [id, , idle] of pending) {
      if (idle < DEFAULT_IDLE_MS) continue;

      const claimed: any[] = await redis.xclaim(
        STREAMS.TASKS, CONSUMER_GROUP, RECLAIMER, DEFAULT_IDLE_MS, id,
      );

      if (!claimed || claimed.length === 0) continue;

      const entry = claimed[0];
      const fields: Record<string, string> = {};
      const rawFields = entry[1];
      for (let i = 0; i < rawFields.length; i += 2) {
        fields[rawFields[i]] = rawFields[i + 1];
      }

      const task = deserializeTask(fields);
      reclaimed++;

      if (task.retryCount < task.maxRetries) {
        const updated: Task = { ...task, retryCount: task.retryCount + 1 };
        const serialized = serializeTask(updated);
        await redis.xadd(STREAMS.TASKS, "*", ...Object.entries(serialized).flat());
      } else {
        const serialized = serializeTask(task);
        await redis.xadd(STREAMS.DLQ, "*", ...Object.entries(serialized).flat());
      }

      await redis.xack(STREAMS.TASKS, CONSUMER_GROUP, id);
      await redis.xdel(STREAMS.TASKS, id);
    }

    return reclaimed;
  }

  async listDLQ(count = 100): Promise<Task[]> {
    const redis = this.client.getRedis();
    const entries: any[] = await redis.xrange(STREAMS.DLQ, "-", "+", "COUNT", count);
    return entries.map(([, rawFields]: [string, string[]]) => {
      const fields: Record<string, string> = {};
      for (let i = 0; i < rawFields.length; i += 2) {
        fields[rawFields[i]] = rawFields[i + 1];
      }
      return deserializeTask(fields);
    });
  }

  async retryFromDLQ(taskId: string): Promise<void> {
    const redis = this.client.getRedis();
    const entries: any[] = await redis.xrange(STREAMS.DLQ, "-", "+");

    for (const [streamId, rawFields] of entries) {
      const fields: Record<string, string> = {};
      for (let i = 0; i < rawFields.length; i += 2) {
        fields[rawFields[i]] = rawFields[i + 1];
      }
      if (fields.id === taskId) {
        const task = deserializeTask(fields);
        const updated: Task = { ...task, retryCount: 0 };
        const serialized = serializeTask(updated);
        await redis.xadd(STREAMS.TASKS, "*", ...Object.entries(serialized).flat());
        await redis.xdel(STREAMS.DLQ, streamId);
        return;
      }
    }

    throw new Error(`Task ${taskId} not found in DLQ`);
  }

  async purgeDLQ(maxAgeMs: number): Promise<number> {
    const redis = this.client.getRedis();
    const entries: any[] = await redis.xrange(STREAMS.DLQ, "-", "+");
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [streamId, rawFields] of entries) {
      const fields: Record<string, string> = {};
      for (let i = 0; i < rawFields.length; i += 2) {
        fields[rawFields[i]] = rawFields[i + 1];
      }
      const createdAt = new Date(fields.createdAt).getTime();
      if (now - createdAt > maxAgeMs) {
        toDelete.push(streamId);
      }
    }

    if (toDelete.length > 0) {
      await redis.xdel(STREAMS.DLQ, ...toDelete);
    }

    return toDelete.length;
  }

  startReclaimer(intervalMs = DEFAULT_INTERVAL_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.reclaimStale().catch(() => {});
    }, intervalMs);
  }

  stopReclaimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
