import { QueueClient } from "./client.js";
import { TaskProducer } from "./producer.js";

/**
 * Monitors queue depth and reports when scaling is needed.
 * Actual K8s Job creation requires kubectl or K8s API access.
 */
export class AutoScaler {
  private readonly client: QueueClient;
  private readonly producer: TaskProducer;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(client: QueueClient) {
    this.client = client;
    this.producer = new TaskProducer(client);
  }

  async checkAndScale(options: {
    pendingThreshold?: number; // spawn worker when pending > this (default 2)
    maxWorkers?: number;       // max concurrent workers (default 5)
    onScaleUp?: (pending: number) => Promise<void>; // callback to spawn worker
  } = {}): Promise<{ action: "scale_up" | "ok"; pending: number; processing: number }> {
    const { pendingThreshold = 2, onScaleUp } = options;
    const stats = await this.producer.stats();

    if (stats.pending > pendingThreshold && onScaleUp) {
      await onScaleUp(stats.pending);
      return { action: "scale_up", pending: stats.pending, processing: stats.processing };
    }

    return { action: "ok", pending: stats.pending, processing: stats.processing };
  }

  startMonitor(intervalMs = 15000, options: Parameters<typeof this.checkAndScale>[0] = {}): void {
    this.interval = setInterval(() => {
      this.checkAndScale(options).catch(console.error);
    }, intervalMs);
  }

  stopMonitor(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
