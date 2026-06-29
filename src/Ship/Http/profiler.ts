import { Elysia } from "elysia";

export interface ProfileData {
	duration: number;
	queries: number;
	memoryBytes: number;
}

/**
 * Global query counter — incremented by the DB proxy wrapper.
 * Reset at the start of each request by the profiler plugin.
 * Only active when profiler is loaded (dev mode).
 */
let queryCount = 0;

export function incrementQueryCount(): void {
	queryCount++;
}

export function resetQueryCount(): void {
	queryCount = 0;
}

const isProduction = process.env.NODE_ENV === "production";

/**
 * Dev-only profiler plugin.
 * Tracks request duration, DB query count, and memory delta.
 * Injects `_profile` into response envelope `meta`.
 *
 * Returns a no-op Elysia instance in production.
 */
export const profilerPlugin = isProduction
	? new Elysia({ name: "profiler:off" })
	: new Elysia({ name: "profiler" })
			.derive({ as: "global" }, () => {
				resetQueryCount();
				const start = performance.now();
				const startHeap = process.memoryUsage().heapUsed;

				return {
					_profileStart: start,
					_profileStartHeap: startHeap,
				};
			})
			.onAfterHandle({ as: "global" }, (ctx) => {
				const start = (ctx as Record<string, unknown>)._profileStart as number | undefined;
				if (start === undefined) return;

				const duration = performance.now() - start;
				const startHeap = (ctx as Record<string, unknown>)._profileStartHeap as number;
				const memoryBytes = process.memoryUsage().heapUsed - (startHeap ?? 0);

				const profile: ProfileData = {
					duration: Math.round(duration * 100) / 100,
					queries: queryCount,
					memoryBytes,
				};

				// Inject into response envelope if it has a `meta` field
				const body = ctx.response;
				if (
					body &&
					typeof body === "object" &&
					"meta" in body &&
					typeof body.meta === "object" &&
					body.meta !== null
				) {
					(body.meta as Record<string, unknown>)._profile = profile;
				}
			});
