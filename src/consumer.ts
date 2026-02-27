import { QueueClient } from "./client.js";
import { type Task, type Result, serializeTask, deserializeTask, serializeResult } from "./schemas.js";
import { STREAMS, CONSUMER_GROUP } from "./streams.js";
import { generateId, isoNow } from "./utils.js";

export class TaskConsumer {
  private running = false;
  private readonly client: QueueClient;
  private readonly workerName: string;

  constructor(client: QueueClient, workerName: string) {
    this.client = client;
    this.workerName = workerName;
  }

  private parseFields(fields: string[]): Record<string, string> {
    const map: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      map[fields[i]] = fields[i + 1];
    }
    return map;
  }

  async start(handler: (task: Task) => Promise<Result["result"]>): Promise<void> {
    this.running = true;
    const redis = this.client.getRedis();

    while (this.running) {
      try {
        const res = await redis.xreadgroup(
          "GROUP", CONSUMER_GROUP, this.workerName,
          "COUNT", "1",
          "BLOCK", "5000",
          "STREAMS", STREAMS.TASKS, ">"
        );

        if (!res || res.length === 0) continue;

        const [, messages] = res[0] as [string, [string, string[]][]];
        if (!messages || messages.length === 0) continue;

        const [streamId, fields] = messages[0];
        const task = deserializeTask(this.parseFields(fields));
        const startedAt = isoNow();
        await this.heartbeat(task.id, task.timeoutMs);

        try {
          const result = await handler(task);
          await this.ack(task.id, streamId, result, startedAt);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          await this.fail(task.id, streamId, errMsg, task);
        }
      } catch {
        if (this.running) await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  async claim(): Promise<{ task: Task; streamId: string } | null> {
    const redis = this.client.getRedis();
    const res = await redis.xreadgroup(
      "GROUP", CONSUMER_GROUP, this.workerName,
      "COUNT", "1",
      "STREAMS", STREAMS.TASKS, ">"
    );

    if (!res || res.length === 0) return null;
    const [, messages] = res[0] as [string, [string, string[]][]];
    if (!messages || messages.length === 0) return null;

    const [streamId, fields] = messages[0];
    const task = deserializeTask(this.parseFields(fields));
    return { task, streamId };
  }

  async ack(taskId: string, streamId: string, result: Result["result"], startedAt: string): Promise<void> {
    const resultObj: Result = {
      taskId,
      worker: this.workerName,
      status: "success",
      result,
      startedAt,
      completedAt: isoNow(),
      durationMs: Date.now() - new Date(startedAt).getTime(),
    };

    const serialized = serializeResult(resultObj);
    const args: string[] = [];
    for (const [k, v] of Object.entries(serialized)) args.push(k, v);

    const pipeline = this.client.getRedis().pipeline();
    pipeline.xack(STREAMS.TASKS, CONSUMER_GROUP, streamId);
    pipeline.xadd(STREAMS.RESULTS, "*", ...args);
    pipeline.xdel(STREAMS.TASKS, streamId);
    await pipeline.exec();
  }

  async fail(taskId: string, streamId: string, error: string, originalTask: Task): Promise<void> {
    const updated: Task = { ...originalTask, retryCount: originalTask.retryCount + 1 };
    const pipeline = this.client.getRedis().pipeline();
    pipeline.xack(STREAMS.TASKS, CONSUMER_GROUP, streamId);
    pipeline.xdel(STREAMS.TASKS, streamId);

    if (updated.retryCount >= updated.maxRetries) {
      // Send to DLQ
      const failResult: Result = {
        taskId,
        worker: this.workerName,
        status: "failed",
        result: { error },
        startedAt: isoNow(),
        completedAt: isoNow(),
        durationMs: 0,
      };
      const serialized = serializeResult(failResult);
      const args: string[] = [];
      for (const [k, v] of Object.entries(serialized)) args.push(k, v);
      pipeline.xadd(STREAMS.DLQ, "*", ...args);
    } else {
      // Re-queue with incremented retryCount
      const serialized = serializeTask(updated);
      const args: string[] = [];
      for (const [k, v] of Object.entries(serialized)) args.push(k, v);
      pipeline.xadd(STREAMS.TASKS, "*", ...args);
    }

    await pipeline.exec();
  }

  async heartbeat(taskId: string, timeoutMs: number): Promise<void> {
    await this.client.getRedis().set(`agent:heartbeat:${taskId}`, this.workerName, "PX", timeoutMs);
  }
}
