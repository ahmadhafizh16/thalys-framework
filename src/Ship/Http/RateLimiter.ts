export interface RateLimitResult {
	allowed: boolean;
	limit: number;
	remaining: number;
	resetsAt: number;
}

export interface RateLimitStore {
	check(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}
