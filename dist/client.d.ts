import { Redis } from "ioredis";
export declare class QueueClient {
    private redis;
    private readonly redisUrl;
    constructor(redisUrl?: string);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    getRedis(): Redis;
    ensureStreams(): Promise<void>;
}
