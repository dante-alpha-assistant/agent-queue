import { Redis } from "ioredis";

export interface QueueClientOptions {
  host?: string;
  port?: number;
  url?: string;
}

export class QueueClient {
  public readonly redis: Redis;

  constructor(opts: QueueClientOptions = {}) {
    if (opts.url) {
      this.redis = new Redis(opts.url);
    } else {
      this.redis = new Redis({ host: opts.host ?? "127.0.0.1", port: opts.port ?? 6379 });
    }
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}
