import { randomUUID } from "node:crypto";
import type { JobPayload, PushOptions, QueueDriver } from "./QueueDriver";

export class InMemoryQueueDriver implements QueueDriver {
	private readonly queues = new Map<string, JobPayload[]>();
	private handler: ((job: JobPayload) => Promise<void>) | null = null;
	private processing = false;

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

		if (!this.queues.has(queue)) this.queues.set(queue, []);
		this.queues.get(queue)!.push(job);

		if (this.handler) this.processNext(queue);
		return id;
	}

	process(handler: (job: JobPayload) => Promise<void>): void {
		this.handler = handler;
		this.processing = true;
		for (const queue of this.queues.keys()) {
			this.processNext(queue);
		}
	}

	async stop(): Promise<void> {
		this.processing = false;
	}

	async size(): Promise<number> {
		let total = 0;
		for (const jobs of this.queues.values()) {
			total += jobs.length;
		}
		return total;
	}

	private async processNext(queue: string): Promise<void> {
		if (!this.processing || !this.handler) return;
		const jobs = this.queues.get(queue);
		if (!jobs || jobs.length === 0) return;

		const job = jobs[0];
		if (!job) return;

		if (job.delayUntil && Date.now() < job.delayUntil) {
			setTimeout(() => this.processNext(queue), job.delayUntil! - Date.now());
			return;
		}

		jobs.shift();
		job.attempts += 1;

		try {
			await this.handler(job);
		} catch (error) {
			if (job.attempts < job.maxAttempts) {
				job.delayUntil = Date.now() + Math.pow(2, job.attempts) * 1000;
				jobs.push(job);
			}
		}

		if (jobs.length > 0) {
			setImmediate(() => this.processNext(queue));
		}
	}
}
