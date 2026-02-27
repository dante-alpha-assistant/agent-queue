import { Redis } from "ioredis";

export interface QueueClientOptions {
  host?: string;
  port?: number;
  url?: string;
}

export class QueueClient {
  public readonly redis: Redis;

  constructor(opts: QueueClientOptions = {}) {
    this.redis = opts.url
      ? new Redis(opts.url)
      : new Redis({ host: opts.host ?? "127.0.0.1", port: opts.port ?? 6379 });
  }

  async disconnect(): Promise<void> {
    this.redis.disconnect();
  }
}
