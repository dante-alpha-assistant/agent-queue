import { Redis } from "ioredis";
import { STREAMS, CONSUMER_GROUP } from "./streams.js";

export class QueueClient {
  private redis: Redis | null = null;
  private readonly redisUrl: string;

  constructor(redisUrl?: string) {
    this.redisUrl = redisUrl ?? "redis://redis.infra.svc.cluster.local:6379";
  }

  async connect(): Promise<void> {
    this.redis = new Redis(this.redisUrl, {
      maxRetriesPerRequest: null,
      retryStrategy(times: number) {
        return Math.min(times * 200, 5000);
      },
      lazyConnect: true,
    });
    await this.redis.connect();
  }

  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
  }

  getRedis(): Redis {
    if (!this.redis) throw new Error("Not connected");
    return this.redis;
  }

  async ensureStreams(): Promise<void> {
    const redis = this.getRedis();
    const streams = [STREAMS.TASKS, STREAMS.RESULTS, STREAMS.DLQ];
    for (const stream of streams) {
      try {
        await redis.xgroup("CREATE", stream, CONSUMER_GROUP, "0", "MKSTREAM");
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("BUSYGROUP")) continue;
        throw err;
      }
    }
  }
}
