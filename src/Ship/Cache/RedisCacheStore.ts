import Redis from "ioredis";
import type { CacheStore, TaggedCache } from "./CacheStore";

export class RedisCacheStore implements CacheStore {
	private readonly redis: Redis;

	constructor(redisUrl: string) {
		this.redis = new Redis(redisUrl, {
			lazyConnect: true,
			retryStrategy: (times) => Math.min(times * 200, 5000),
		});
	}

	async get<T>(key: string): Promise<T | null> {
		const raw = await this.redis.get(key);
		if (raw === null) return null;
		return JSON.parse(raw) as T;
	}

	async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
		const serialized = JSON.stringify(value);
		if (ttlMs) {
			await this.redis.set(key, serialized, "PX", ttlMs);
		} else {
			await this.redis.set(key, serialized);
		}
	}

	async forget(key: string): Promise<void> {
		await this.redis.del(key);
	}

	async has(key: string): Promise<boolean> {
		return (await this.redis.exists(key)) === 1;
	}

	async flush(): Promise<void> {
		await this.redis.flushdb();
	}

	tag(...tags: string[]): TaggedCache {
		return new RedisTaggedCache(this.redis, tags);
	}

	async disconnect(): Promise<void> {
		await this.redis.quit();
	}

	async ping(): Promise<boolean> {
		try {
			const reply = await this.redis.ping();
			return reply === "PONG";
		} catch {
			return false;
		}
	}
}

class RedisTaggedCache implements TaggedCache {
	constructor(
		private readonly redis: Redis,
		private readonly tags: string[],
	) {}

	async get<T>(key: string): Promise<T | null> {
		const raw = await this.redis.get(this.taggedKey(key));
		if (raw === null) return null;
		return JSON.parse(raw) as T;
	}

	async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
		const tagged = this.taggedKey(key);
		const serialized = JSON.stringify(value);
		const pipeline = this.redis.pipeline();

		if (ttlMs) {
			pipeline.set(tagged, serialized, "PX", ttlMs);
		} else {
			pipeline.set(tagged, serialized);
		}

		for (const tag of this.tags) {
			pipeline.sadd(`tag:${tag}`, tagged);
		}

		await pipeline.exec();
	}

	async forget(key: string): Promise<void> {
		await this.redis.del(this.taggedKey(key));
	}

	async flush(): Promise<void> {
		const tagKeys = this.tags.map((t) => `tag:${t}`);
		const results = await Promise.all(tagKeys.map((tk) => this.redis.smembers(tk)));

		const keysToDelete = new Set<string>();
		for (const members of results) {
			for (const member of members) {
				keysToDelete.add(member);
			}
		}

		if (keysToDelete.size > 0) {
			await this.redis.del(...keysToDelete);
		}
		if (tagKeys.length > 0) {
			await this.redis.del(...tagKeys);
		}
	}

	private taggedKey(key: string): string {
		return `${this.tags.sort().join(":")}:${key}`;
	}
}
