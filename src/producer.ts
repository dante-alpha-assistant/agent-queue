import { QueueClient } from "./client.js";
import { type Task, type Result, serializeTask, deserializeResult } from "./schemas.js";
import { STREAMS, CONSUMER_GROUP } from "./streams.js";
import { generateId, now } from "./utils.js";

type DispatchInput = Omit<Task, "id" | "createdAt" | "retryCount">;
type UrgentInput = Omit<Task, "id" | "createdAt" | "retryCount" | "priority">;

export class TaskProducer {
  private readonly client: QueueClient;

  constructor(client: QueueClient) {
    this.client = client;
  }

  async dispatch(task: DispatchInput): Promise<string> {
    const id = generateId();
    const full: Task = { ...task, id, createdAt: now(), retryCount: 0 };
    const fields = serializeTask(full);
    const args: string[] = [];
    for (const [k, v] of Object.entries(fields)) {
      args.push(k, v);
    }
    await this.client.redis.xadd(STREAMS.TASKS, "*", ...args);
    return id;
  }

  async dispatchUrgent(task: UrgentInput): Promise<string> {
    return this.dispatch({ ...task, priority: "high" });
  }

  async awaitResult(taskId: string, timeoutMs = 30_000): Promise<Result | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const entries = await this.client.redis.xrange(STREAMS.RESULTS, "-", "+");
      for (const [, fields] of entries) {
        const map: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          map[fields[i]] = fields[i + 1];
        }
        if (map.taskId === taskId) {
          return deserializeResult(map);
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return null;
  }

  async pollResults(count = 10): Promise<Result[]> {
    const entries = await this.client.redis.xrevrange(STREAMS.RESULTS, "+", "-", "COUNT", count);
    return entries.map(([, fields]) => {
      const map: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        map[fields[i]] = fields[i + 1];
      }
      return deserializeResult(map);
    });
  }

  async stats(): Promise<{ pending: number; processing: number; completed: number; failed: number }> {
    const [pending, completed, failed] = await Promise.all([
      this.client.redis.xlen(STREAMS.TASKS),
      this.client.redis.xlen(STREAMS.RESULTS),
      this.client.redis.xlen(STREAMS.DLQ),
    ]);
    let processing = 0;
    try {
      const info = await this.client.redis.xpending(STREAMS.TASKS, CONSUMER_GROUP);
      if (Array.isArray(info) && typeof info[0] === "number") {
        processing = info[0];
      }
    } catch {
      // Group may not exist yet
    }
    return { pending, processing, completed, failed };
  }
}
