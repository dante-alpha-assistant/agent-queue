import { QueueClient } from "./client.js";
import { type Task, type Result, serialize, deserialize, validateTask } from "./schemas.js";
import { STREAMS, CONSUMER_GROUP } from "./streams.js";
import { timestamp } from "./utils.js";

export class TaskConsumer {
  private running = false;
  private readonly client: QueueClient;
  private readonly workerName: string;

  constructor(client: QueueClient, workerName: string) {
    this.client = client;
    this.workerName = workerName;
  }

  async start(handler: (task: Task) => Promise<Result["result"]>): Promise<void> {
    this.running = true;

    // Ensure consumer group exists
    try {
      await this.client.redis.xgroup("CREATE", STREAMS.TASKS, CONSUMER_GROUP, "0", "MKSTREAM");
    } catch {
      // group already exists — fine
    }

    while (this.running) {
      try {
        const res = await this.client.redis.xreadgroup(
          "GROUP", CONSUMER_GROUP, this.workerName,
          "COUNT", "1",
          "BLOCK", "5000",
          "STREAMS", STREAMS.TASKS, ">"
        );

        if (!res || res.length === 0) continue;

        const [, messages] = res[0] as [string, [string, string[]][]];
        if (!messages || messages.length === 0) continue;

        const [streamId, fields] = messages[0];
        const fieldMap: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          fieldMap[fields[i]] = fields[i + 1];
        }

        const task = deserialize<Task>(fieldMap);
        if (!validateTask(task)) {
          await this.client.redis.xack(STREAMS.TASKS, CONSUMER_GROUP, streamId);
          await this.client.redis.xdel(STREAMS.TASKS, streamId);
          continue;
        }

        const startedAt = timestamp();
        await this.heartbeat(task.taskId, task.timeoutMs);

        try {
          const result = await handler(task);
          await this.ack(task.taskId, streamId, result, startedAt);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          await this.fail(task.taskId, streamId, errMsg, task);
        }
      } catch {
        // transient redis error — wait and retry
        if (this.running) await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  async claim(): Promise<{ task: Task; streamId: string } | null> {
    try {
      await this.client.redis.xgroup("CREATE", STREAMS.TASKS, CONSUMER_GROUP, "0", "MKSTREAM");
    } catch {
      // already exists
    }

    const res = await this.client.redis.xreadgroup(
      "GROUP", CONSUMER_GROUP, this.workerName,
      "COUNT", "1",
      "STREAMS", STREAMS.TASKS, ">"
    );

    if (!res || res.length === 0) return null;

    const [, messages] = res[0] as [string, [string, string[]][]];
    if (!messages || messages.length === 0) return null;

    const [streamId, fields] = messages[0];
    const fieldMap: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      fieldMap[fields[i]] = fields[i + 1];
    }

    const task = deserialize<Task>(fieldMap);
    if (!validateTask(task)) return null;

    return { task, streamId };
  }

  async ack(taskId: string, streamId: string, result: Result["result"], startedAt: string): Promise<void> {
    const resultObj: Result = {
      taskId,
      result,
      workerName: this.workerName,
      startedAt,
      completedAt: timestamp(),
    };

    const pipeline = this.client.redis.pipeline();
    pipeline.xack(STREAMS.TASKS, CONSUMER_GROUP, streamId);
    pipeline.xadd(STREAMS.RESULTS, "*", ...Object.entries(serialize(resultObj)).flat());
    pipeline.xdel(STREAMS.TASKS, streamId);
    await pipeline.exec();
  }

  async fail(taskId: string, streamId: string, error: string, originalTask: Task): Promise<void> {
    const updated: Task = { ...originalTask, retryCount: originalTask.retryCount + 1 };
    const targetStream = updated.retryCount >= updated.maxRetries ? STREAMS.DLQ : STREAMS.TASKS;

    const pipeline = this.client.redis.pipeline();
    pipeline.xack(STREAMS.TASKS, CONSUMER_GROUP, streamId);
    pipeline.xdel(STREAMS.TASKS, streamId);

    if (targetStream === STREAMS.DLQ) {
      const failResult: Result = {
        taskId,
        result: "failure",
        error,
        workerName: this.workerName,
        startedAt: timestamp(),
        completedAt: timestamp(),
      };
      pipeline.xadd(STREAMS.DLQ, "*", ...Object.entries(serialize(failResult)).flat());
    } else {
      pipeline.xadd(STREAMS.TASKS, "*", ...Object.entries(serialize(updated)).flat());
    }

    await pipeline.exec();
  }

  async heartbeat(taskId: string, timeoutMs: number): Promise<void> {
    await this.client.redis.set(`agent:heartbeat:${taskId}`, this.workerName, "PX", timeoutMs);
  }
}
