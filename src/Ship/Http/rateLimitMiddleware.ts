import { AppError } from "@ship/Exceptions/AppError";
import type { RateLimitStore } from "./RateLimiter";

export interface RateLimitConfig {
	limit: number;
	windowMs: number;
	keyGenerator?: (ctx: { request: Request }) => string;
}

type BeforeHandleCtx = {
	request: Request;
	set: {
		headers: Record<string, string | number>;
	};
};

export function rateLimitMiddleware(store: RateLimitStore, config: RateLimitConfig) {
	const keyFn =
		config.keyGenerator ??
		(({ request }: { request: Request }) =>
			request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "anonymous");

	return async (ctx: BeforeHandleCtx) => {
		const key = keyFn(ctx);
		const result = await store.check(key, config.limit, config.windowMs);

		ctx.set.headers["X-RateLimit-Limit"] = String(result.limit);
		ctx.set.headers["X-RateLimit-Remaining"] = String(result.remaining);
		ctx.set.headers["X-RateLimit-Reset"] = String(result.resetsAt);

		if (!result.allowed) {
			ctx.set.headers["Retry-After"] = String(
				Math.max(0, result.resetsAt - Math.ceil(Date.now() / 1000)),
			);
			throw new AppError(429, "RATE_LIMIT_EXCEEDED", "Too many requests. Please try again later.");
		}
	};
}
