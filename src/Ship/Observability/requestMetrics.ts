import { Elysia } from "elysia";
import type { MetricsRegistry } from "./metrics";

const DURATION_BUCKETS = [1, 5, 10, 50, 100, 500, 1000, Number.POSITIVE_INFINITY];

/**
 * Request metrics plugin.
 *
 * Increments a counter (method, status labels) and records a histogram
 * (request duration in ms) for every request.
 *
 * Uses `onAfterHandle` + `onError` — same pattern as requestLoggerPlugin (E8.1).
 * `onAfterResponse` does not fire with `app.handle()` in Bun tests.
 */
export function requestMetricsPlugin(registry: MetricsRegistry) {
	return new Elysia({ name: "request-metrics" })
		.derive({ as: "global" }, () => ({
			_metricsStartedAt: Date.now(),
		}))
		.onAfterHandle({ as: "global" }, (ctx) => {
			recordMetrics(registry, ctx);
		})
		.onError({ as: "global" }, (ctx) => {
			recordMetrics(registry, ctx);
		});
}

function recordMetrics(
	registry: MetricsRegistry,
	ctx: {
		request: Request;
		set: { status?: number | string };
		_metricsStartedAt?: number;
	},
): void {
	const start = ctx._metricsStartedAt;
	const duration = start !== undefined ? Date.now() - start : 0;
	const rawStatus = ctx.set.status;
	const status =
		typeof rawStatus === "string" ? Number.parseInt(rawStatus, 10) : (rawStatus ?? 500);

	const url = new URL(ctx.request.url);
	const path = url.pathname;

	// Skip /health and /metrics — they're infrastructure, not business traffic
	if (
		path === "/api/health" ||
		path === "/health" ||
		path === "/api/metrics" ||
		path === "/metrics"
	) {
		return;
	}

	const method = ctx.request.method;

	registry.counter(
		"thalys_requests_total",
		1,
		{ method, status: String(status) },
		"Total HTTP requests",
	);

	registry.histogram(
		"thalys_request_duration_ms",
		duration,
		{ method },
		DURATION_BUCKETS,
		"Request duration in milliseconds",
	);
}
