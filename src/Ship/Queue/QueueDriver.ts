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
