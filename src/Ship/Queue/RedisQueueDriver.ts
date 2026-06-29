import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import type { JobPayload, PushOptions, QueueDriver } from "./QueueDriver";

export class RedisQueueDriver implements QueueDriver {
	private readonly redis: Redis;
	private handler: ((job: JobPayload) => Promise<void>) | null = null;
	private polling = false;
	private pollTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(redisUrl: string) {
		this.redis = new Redis(redisUrl, { lazyConnect: true });
	}

	async push(jobName: string, payload: unknown, options?: PushOptions): Promise<string> {
		const id = randomUUID();
		const queue = options?.queue ?? "default";
		const job: JobPayload = {
			id,
			job: jobName,
			payload,
			attempts: 0,
			maxAttempts: options?.maxAttempts ?? 3,
			delayUntil: options?.delay ? Date.now() + options.delay : undefined,
			createdAt: Date.now(),
		};

		await this.redis.rpush(`queue:${queue}`, JSON.stringify(job));
		return id;
	}

	process(handler: (job: JobPayload) => Promise<void>): void {
		this.handler = handler;
		this.polling = true;
		this.poll();
	}

	async stop(): Promise<void> {
		this.polling = false;
		if (this.pollTimer) clearTimeout(this.pollTimer);
	}

	async size(): Promise<number> {
		const keys = await this.redis.keys("queue:*");
		let total = 0;
		for (const key of keys) {
			total += await this.redis.llen(key);
		}
		return total;
	}

	private async poll(): Promise<void> {
		if (!this.polling || !this.handler) return;

		const result = await this.redis.blpop("queue:default", 1);
		if (result) {
			const [, raw] = result;
			const job: JobPayload = JSON.parse(raw);
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

	async disconnect(): Promise<void> {
		await this.stop();
		await this.redis.quit();
	}
}
