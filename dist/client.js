import { Redis } from "ioredis";
import { STREAMS, CONSUMER_GROUP } from "./streams.js";
export class QueueClient {
    redis = null;
    redisUrl;
    constructor(redisUrl) {
        this.redisUrl = redisUrl ?? "redis://redis.infra.svc.cluster.local:6379";
    }
    async connect() {
        this.redis = new Redis(this.redisUrl, {
            maxRetriesPerRequest: null,
            retryStrategy(times) {
                return Math.min(times * 200, 5000);
            },
            lazyConnect: true,
        });
        await this.redis.connect();
    }
    async disconnect() {
        if (this.redis) {
            await this.redis.quit();
            this.redis = null;
        }
    }
    getRedis() {
        if (!this.redis)
            throw new Error("Not connected");
        return this.redis;
    }
    async ensureStreams() {
        const redis = this.getRedis();
        const streams = [STREAMS.TASKS, STREAMS.RESULTS, STREAMS.DLQ];
        for (const stream of streams) {
            try {
                await redis.xgroup("CREATE", stream, CONSUMER_GROUP, "0", "MKSTREAM");
            }
            catch (err) {
                if (err instanceof Error && err.message.includes("BUSYGROUP"))
                    continue;
                throw err;
            }
        }
    }
}
