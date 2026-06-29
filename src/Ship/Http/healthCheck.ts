import { RedisCacheStore } from "@ship/Cache/RedisCacheStore";
import { appClient } from "@ship/database/connection";
import { Elysia } from "elysia";

interface HealthCheck {
	status: "ok" | "degraded";
	latencyMs: number;
}

async function checkDatabase(): Promise<HealthCheck> {
	const start = Date.now();
	try {
		await appClient`SELECT 1`;
		return { status: "ok", latencyMs: Date.now() - start };
	} catch {
		return { status: "degraded", latencyMs: Date.now() - start };
	}
}

async function checkRedis(): Promise<HealthCheck | null> {
	if (!process.env.REDIS_URL) return null;

	const start = Date.now();
	const { container } = await import("@ship/setup");
	const cache = container.make("cache" as never) as unknown;
	if (!(cache instanceof RedisCacheStore)) return null;

	try {
		const ok = await cache.ping();
		return { status: ok ? "ok" : "degraded", latencyMs: Date.now() - start };
	} catch {
		return { status: "degraded", latencyMs: Date.now() - start };
	}
}

const startTime = Date.now();

/**
 * Health check plugin.
 * Returns 200 if all checks pass, 503 if any check fails.
 * No auth, no rate limiting — accessible by orchestrators.
 */
export const healthCheckPlugin = new Elysia({ name: "health-check" }).get(
	"/health",
	async ({ set }) => {
		const [dbCheck, redisCheck] = await Promise.all([checkDatabase(), checkRedis()]);

		const allChecks = [dbCheck, ...(redisCheck ? [redisCheck] : [])];
		const allHealthy = allChecks.every((c) => c.status === "ok");

		set.status = allHealthy ? 200 : 503;
		return {
			status: allHealthy ? "healthy" : "unhealthy",
			uptime: Math.floor((Date.now() - startTime) / 1000),
			checks: {
				database: dbCheck,
				...(redisCheck ? { redis: redisCheck } : {}),
			},
		};
	},
);
