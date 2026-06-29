import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import type { RateLimitResult, RateLimitStore } from "./RateLimiter";

export class RedisRateLimitStore implements RateLimitStore {
	private readonly redis: Redis;

	constructor(redisUrl: string) {
		this.redis = new Redis(redisUrl, { lazyConnect: true });
	}

	async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
		const now = Date.now();
		const windowStart = now - windowMs;
		const redisKey = `ratelimit:${key}`;

		const pipeline = this.redis.pipeline();
		pipeline.zremrangebyscore(redisKey, 0, windowStart);
		pipeline.zadd(redisKey, now, `${now}:${randomUUID()}`);
		pipeline.zcard(redisKey);
		pipeline.pexpire(redisKey, windowMs);

		const results = await pipeline.exec();
		const count = (results?.[2]?.[1] as number) ?? 0;
		const remaining = Math.max(0, limit - count);

		return {
			allowed: count <= limit,
			limit,
			remaining,
			resetsAt: Math.ceil((windowStart + windowMs) / 1000),
		};
	}

	async disconnect(): Promise<void> {
		await this.redis.quit();
	}
}
