import type { RateLimitResult, RateLimitStore } from "./RateLimiter";

export class InMemoryRateLimitStore implements RateLimitStore {
	private readonly hits = new Map<string, number[]>();

	async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
		const now = Date.now();
		const windowStart = now - windowMs;
		const timestamps = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
		timestamps.push(now);
		this.hits.set(key, timestamps);

		const remaining = Math.max(0, limit - timestamps.length);
		const resetsAt = Math.ceil((timestamps[0]! + windowMs) / 1000);

		return {
			allowed: timestamps.length <= limit,
			limit,
			remaining,
			resetsAt,
		};
	}
}
