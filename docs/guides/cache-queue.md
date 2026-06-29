# Cache & Queue

Thalys provides two infrastructure subsystems behind swappable interfaces: a cache store (with tag-based invalidation and a `remember()` cache-aside helper) and a queue driver (with retry, backoff, and a dedicated worker process). Both default to in-memory implementations for development and switch to Redis automatically when `REDIS_URL` is set.

## How it works under the hood

```txt
registerServices.ts
  │
  ├─ REDIS_URL set?  ──► RedisCacheStore + RedisQueueDriver
  └─ REDIS_URL unset? ──► InMemoryCacheStore + InMemoryQueueDriver
  │
  ▼
container.set("cache", cache)
container.set("queue", queue)
  │
  ▼
Resolve from Actions: container.make("cache") / container.make("queue")
```

The selection happens once at boot in `createContainer()` — there is no runtime switching. Both implementations satisfy the same interface, so business code is identical regardless of environment.

## Cache

### The CacheStore interface

```ts
// src/Ship/Cache/CacheStore.ts
export interface CacheStore {
	get<T>(key: string): Promise<T | null>;
	set(key: string, value: unknown, ttlMs?: number): Promise<void>;
	forget(key: string): Promise<void>;
	has(key: string): Promise<boolean>;
	flush(): Promise<void>;
	tag(...tags: string[]): TaggedCache;
}

export interface TaggedCache {
	get<T>(key: string): Promise<T | null>;
	set(key: string, value: unknown, ttlMs?: number): Promise<void>;
	forget(key: string): Promise<void>;
	flush(): Promise<void>;
}
```

### InMemoryCacheStore (dev)

A `Map<string, CacheEntry>` with TTL expiry. No external dependencies — perfect for local development and testing:

```ts
// src/Ship/Cache/InMemoryCacheStore.ts (simplified)
export class InMemoryCacheStore implements CacheStore {
	private readonly store = new Map<string, CacheEntry>();

	async get<T>(key: string): Promise<T | null> {
		const entry = this.store.get(key);
		if (!entry) return null;
		if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
			this.store.delete(key);
			return null;
		}
		return entry.value as T;
	}

	async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
		this.store.set(key, {
			value,
			expiresAt: ttlMs ? Date.now() + ttlMs : null,
			tags: [],
		});
	}

	async forget(key: string): Promise<void> {
		this.store.delete(key);
	}
}
```

### RedisCacheStore (prod)

Uses `ioredis` with JSON serialization. TTL is set via Redis `PX` (milliseconds). Tagged cache uses Redis Sets to track which keys belong to which tag:

```ts
// src/Ship/Cache/RedisCacheStore.ts (simplified)
export class RedisCacheStore implements CacheStore {
	private readonly redis: Redis;

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
}
```

### Tag-based invalidation

Tags let you group cache entries and flush them all at once. This is essential when a single domain event should invalidate multiple cache keys:

```ts
const cache = container.make<CacheStore>("cache");

// Cache a user with tags
await cache.tag("users", "user:123").set("user:123:profile", profile, 60_000);

// Cache a list with the same tag
await cache.tag("users").set("users:page:1", userList, 60_000);

// Invalidate everything tagged "users" when a user is updated
await cache.tag("users").flush();
```

Under the hood, the Redis implementation uses Redis Sets:

```ts
// RedisTaggedCache.set():
const pipeline = this.redis.pipeline();
pipeline.set(taggedKey, serialized, "PX", ttlMs);
for (const tag of this.tags) {
	pipeline.sadd(`tag:${tag}`, taggedKey);  // track key under each tag
}
await pipeline.exec();

// RedisTaggedCache.flush():
const tagKeys = this.tags.map((t) => `tag:${t}`);
const members = await Promise.all(tagKeys.map((tk) => this.redis.smembers(tk)));
// Collect all keys, delete them, then delete the tag sets themselves
```

The in-memory implementation scans the map and deletes entries whose `tags` array intersects the flush tags.

### remember() — cache-aside pattern

The `remember()` helper implements the cache-aside pattern: try cache first, and if it's a miss, call the factory function, cache the result, and return it:

```ts
// src/Ship/Cache/remember.ts
export async function remember<T>(
	cache: CacheStore,
	key: string,
	ttlMs: number,
	fn: () => Promise<T>,
): Promise<T> {
	const cached = await cache.get<T>(key);
	if (cached !== null) return cached;
	const fresh = await fn();
	await cache.set(key, fresh, ttlMs);
	return fresh;
}
```

Usage in an Action:

```ts
import { remember } from "@ship/Cache/remember";

export class GetUserProfileAction extends BaseAction {
	async execute(userId: string) {
		const cache = this.container.make<CacheStore>("cache");

		return remember(cache, `user:profile:${userId}`, 60_000, async () => {
			const user = await this.userRepo.findById(userId);
			if (!user) throw new NotFoundError("User");
			return new UserTransformer().transform(user);
		});
	}
}
```

::: warning Cache stampede
`remember()` does not deduplicate concurrent fetches — if two requests miss the cache simultaneously, both will call `fn()`. For expensive operations, add a lock (e.g. Redis `SETNX`) around the factory call. For most use cases, the double-fetch is acceptable and the simplicity is worth it.
:::

## Queue

### The QueueDriver interface

```ts
// src/Ship/Queue/QueueDriver.ts
export interface JobPayload {
	id: string;
	job: string;
	payload: unknown;
	attempts: number;
	maxAttempts: number;
	delayUntil?: number;
	createdAt: number;
}

export interface QueueDriver {
	push(jobName: string, payload: unknown, options?: PushOptions): Promise<string>;
	process(handler: (job: JobPayload) => Promise<void>): void;
	stop(): Promise<void>;
	size(): Promise<number>;
}

export interface PushOptions {
	delay?: number;
	maxAttempts?: number;
	queue?: string;
}
```

### InMemoryQueueDriver (dev)

Stores jobs in an in-memory array and processes them with `setImmediate`. When a job fails and hasn't exceeded `maxAttempts`, it's re-queued with exponential backoff:

```ts
// src/Ship/Queue/InMemoryQueueDriver.ts (simplified)
private async processNext(queue: string): Promise<void> {
	const job = jobs.shift();
	job.attempts += 1;

	try {
		await this.handler(job);
	} catch (error) {
		if (job.attempts < job.maxAttempts) {
			job.delayUntil = Date.now() + Math.pow(2, job.attempts) * 1000;
			jobs.push(job);  // retry with backoff
		}
	}

	if (jobs.length > 0) {
		setImmediate(() => this.processNext(queue));
	}
}
```

### RedisQueueDriver (prod)

Uses Redis lists with `BLPOP` for blocking dequeue. Failed jobs are moved to a delayed list and re-queued after the backoff period:

```ts
// src/Ship/Queue/RedisQueueDriver.ts (simplified)
private async poll(): Promise<void> {
	const result = await this.redis.blpop("queue:default", 1);
	if (result) {
		const job: JobPayload = JSON.parse(result[1]);
		job.attempts += 1;

		try {
			await this.handler(job);
		} catch (error) {
			if (job.attempts < job.maxAttempts) {
				const delay = Math.pow(2, job.attempts) * 1000;
				job.delayUntil = Date.now() + delay;
				await this.redis.rpush(`queue:${job.id}:delayed`, JSON.stringify(job));
				setTimeout(async () => {
					const delayed = await this.redis.lpop(`queue:${job.id}:delayed`);
					if (delayed) await this.redis.rpush("queue:default", delayed);
				}, delay);
			}
		}
	}

	if (this.polling) {
		this.pollTimer = setTimeout(() => this.poll(), 10);
	}
}
```

::: tip Two Redis connections in RedisQueueDriver
The `RedisQueueDriver` uses a single Redis connection for both `push` (RPUSH) and `poll` (BLPOP). In a production setup where the worker runs `BLPOP` (which blocks), you need a **separate connection** for pushing jobs from the HTTP process. The current implementation handles this by having the HTTP process create its own `RedisQueueDriver` instance for pushing, while the worker process creates one for polling. Each instance has its own connection.
:::

### BaseJob

Jobs extend `BaseJob` and implement `handle()`. The `name` property is used for serialization/deserialization — it's how the worker knows which class to instantiate:

```ts
// src/Ship/Queue/BaseJob.ts
export abstract class BaseJob<TPayload = unknown> {
	abstract readonly name: string;
	abstract readonly maxAttempts: number;
	readonly queue = "default";
	readonly delay = 0;

	abstract handle(payload: TPayload): Promise<void>;

	async failed(_payload: TPayload, error: Error): Promise<void> {
		console.error(`Job ${this.name} failed after ${this.maxAttempts} attempts:`, error);
	}
}
```

A concrete job:

```ts
import { BaseJob } from "@ship/Queue/BaseJob";

export class SendWelcomeEmailJob extends BaseJob<{ email: string; name: string }> {
	readonly name = "send-welcome-email";
	readonly maxAttempts = 3;

	async handle(payload: { email: string; name: string }): Promise<void> {
		await emailService.send(payload.email, "Welcome!", `Hi ${payload.name}`);
	}
}
```

### JobRegistry

The `JobRegistry` maps job names to their classes. The worker uses it to deserialize a `JobPayload` (which only has the job name string) back into a `BaseJob` instance:

```ts
// src/Ship/Queue/JobRegistry.ts
class JobRegistry {
	private readonly jobs = new Map<string, JobClass>();

	register(job: JobClass): void {
		const instance = new job();
		this.jobs.set(instance.name, job);
	}

	resolve(name: string): BaseJob {
		const JobClass = this.jobs.get(name);
		if (!JobClass) {
			throw new Error(`No job registered with name "${name}".`);
		}
		return new JobClass();
	}
}

export const jobRegistry = new JobRegistry();
```

Register jobs at boot:

```ts
import { SendWelcomeEmailJob } from "@containers/User/Jobs/SendWelcomeEmailJob";
import { jobRegistry } from "@ship/Queue/JobRegistry";

jobRegistry.register(SendWelcomeEmailJob);
```

### Dispatching jobs

Push a job to the queue from any Action:

```ts
const queue = container.make<QueueDriver>("queue");

await queue.push("send-welcome-email", {
	email: "ada@example.com",
	name: "Ada Lovelace",
}, {
	maxAttempts: 3,
	delay: 0,
});
```

### The worker process

Jobs are processed by a separate worker process, not the HTTP server:

```bash
bun run command thalys:work
```

The `WorkCommand` resolves the queue driver from the container, registers a handler that uses `JobRegistry` to deserialize and execute jobs, and runs until `SIGINT`:

```ts
// src/Ship/Queue/WorkCommand.ts
export class WorkCommand extends ConsoleCommand<WorkInput> {
	readonly signature = "thalys:work {--q|queue=default : Queue name to consume}";

	async handle(input: WorkInput, context: ConsoleContext): Promise<void> {
		const queueDriver = context.container.make("queue" as never) as QueueDriver;

		context.log.info({ queue: input.queue }, "Worker started");

		queueDriver.process(async (job) => {
			const instance = jobRegistry.resolve(job.job);
			try {
				await instance.handle(job.payload);
				context.log.info({ job: job.job, id: job.id }, "Job completed");
			} catch (error) {
				context.log.error({ job: job.job, id: job.id, error }, "Job failed");
				throw error;  // driver handles retry/backoff
			}
		});

		await new Promise<void>((resolve) => {
			process.on("SIGINT", async () => {
				context.log.info("Worker shutting down...");
				await queueDriver.stop();
				if (queueDriver instanceof RedisQueueDriver) {
					await queueDriver.disconnect();
				}
				resolve();
			});
		});
	}
}
```

::: tip Run one HTTP server + one worker
In production, run two processes: the HTTP server (`bun run start`) and the queue worker (`bun run command thalys:work`). They share the same codebase but have different entrypoints. The HTTP process pushes jobs; the worker process consumes them. Scale them independently — you might run 4 HTTP instances but only 1 worker.
:::

## Code examples

### Caching with tags and remember

```ts
import { remember } from "@ship/Cache/remember";
import type { CacheStore } from "@ship/Cache/CacheStore";

export class ListProductsAction extends BaseAction {
	async execute(page: number) {
		const cache = this.container.make<CacheStore>("cache");

		return remember(
			cache,
			`products:page:${page}`,
			60_000,
			async () => {
				const result = await this.productRepo.paginate({ page });
				return {
					data: result.data.map((p) => new ProductTransformer().transform(p)),
					meta: result.meta,
				};
			},
		);
	}

	async invalidate() {
		const cache = this.container.make<CacheStore>("cache");
		await cache.tag("products").flush();
	}
}
```

### Dispatching and processing a job

```ts
// Dispatch (from an Action):
const queue = container.make<QueueDriver>("queue");
await queue.push("send-welcome-email", { email, name }, { maxAttempts: 3 });

// Process (in the worker, via JobRegistry):
// thalys:work resolves "send-welcome-email" → SendWelcomeEmailJob → handle(payload)
```

### Retry with exponential backoff

Jobs that fail are retried with exponential backoff: `delay = 2^attempts * 1000ms`. So the first retry waits 2s, the second 4s, the third 8s. After `maxAttempts` is reached, the job's `failed()` method is called:

```ts
export class ProcessPaymentJob extends BaseJob<PaymentPayload> {
	readonly name = "process-payment";
	readonly maxAttempts = 5;

	async handle(payload: PaymentPayload): Promise<void> {
		await paymentGateway.charge(payload);
	}

	async failed(payload: PaymentPayload, error: Error): Promise<void> {
		await this.notifyOps(payload, error);
	}
}
```
