# Health & Metrics

Thalys ships with three observability subsystems wired into the request pipeline: a health check endpoint for orchestrators, structured request logging via Pino, and a Prometheus-compatible metrics endpoint. All three are active by default with zero configuration.

## Health check

### The endpoint

```
GET /api/health
```

No auth, no rate limiting. Returns `200` if all checks pass, `503` if any check fails:

```json
{
  "status": "healthy",
  "uptime": 3600,
  "checks": {
    "database": { "status": "ok", "latencyMs": 2 },
    "redis": { "status": "ok", "latencyMs": 1 }
  }
}
```

When Redis is not configured (`REDIS_URL` unset), the `redis` check is omitted entirely:

```json
{
  "status": "healthy",
  "uptime": 3600,
  "checks": {
    "database": { "status": "ok", "latencyMs": 2 }
  }
}
```

### How checks work

Each check runs a single primitive operation and measures latency:

```ts
// src/Ship/Http/healthCheck.ts
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
```

- **Database check** — executes `SELECT 1` against the Postgres pool.
- **Redis check** — calls `PING` on the Redis connection (only when `REDIS_URL` is set and the cache is a `RedisCacheStore`).

The health plugin runs both checks in parallel via `Promise.all`:

```ts
export const healthCheckPlugin = new Elysia({ name: "health-check" }).get(
	"/health",
	async ({ set }) => {
		const [dbCheck, redisCheck] = await Promise.all([
			checkDatabase(),
			checkRedis(),
		]);

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
```

::: tip Orchestrator integration
Configure Kubernetes or Docker health probes to hit `/api/health`. Use `livenessProbe` with a short interval (e.g. 10s) — if the database is unreachable, the pod will report `503` and be restarted. Use `readinessProbe` to stop routing traffic to an unhealthy instance without killing it.
:::

## Request logging

Every request (except health checks) produces one structured Pino log entry. The logger runs as a global Elysia plugin that hooks both `onAfterHandle` (for successful responses) and `onError` (for thrown errors):

```ts
// src/Ship/Http/requestLogger.ts
export function requestLoggerPlugin(logger: AppLogger) {
	return new Elysia({ name: "request-logger" })
		.derive({ as: "global" }, () => ({
			_logStartedAt: Date.now(),
		}))
		.onAfterHandle({ as: "global" }, (ctx) => {
			const url = new URL(ctx.request.url);
			if (shouldSkip(url.pathname)) return;
			logRequest(logger, ctx);
		})
		.onError({ as: "global" }, (ctx) => {
			const url = new URL(ctx.request.url);
			if (shouldSkip(url.pathname)) return;
			logRequest(logger, ctx);
		});
}
```

::: warning Why both onAfterHandle and onError?
Elysia's `onAfterHandle` does not fire when a handler throws — the request is routed to `onError` instead. And `onAfterResponse` (which would cover both) does not fire reliably when testing via `app.handle()`. Hooking both `onAfterHandle` and `onError` ensures every request is logged, whether it succeeded or failed.
:::

### The log entry

Each entry includes method, path, status, duration, userId, and IP:

```ts
function logRequest(logger: AppLogger, ctx): void {
	const url = new URL(ctx.request.url);
	const start = ctx._logStartedAt;
	const duration = start !== undefined ? Date.now() - start : 0;
	const status = typeof rawStatus === "string" ? Number.parseInt(rawStatus, 10) : (rawStatus ?? 500);

	const entry = {
		requestId: ctx.requestId,
		method: ctx.request.method,
		path: url.pathname,
		status,
		duration,
		userId: ctx.currentUser?.userId,
		ip: ctx.request.headers.get("x-forwarded-for") ?? "127.0.0.1",
	};

	if (status >= 500) {
		logger.error(entry, "request");
	} else if (status >= 400) {
		logger.warn(entry, "request");
	} else {
		logger.info(entry, "request");
	}
}
```

| Status range | Log level | Rationale |
| --- | --- | --- |
| 2xx | `info` | Normal operation |
| 4xx | `warn` | Client error — expected flow, but worth monitoring |
| 5xx | `error` | Server error — needs investigation |

### Health check requests are skipped

Health check endpoints are polled frequently by orchestrators (every 10-15 seconds). Logging each poll would generate enormous noise. The logger skips `/api/health` and `/health`:

```ts
function shouldSkip(path: string): boolean {
	return path === "/api/health" || path === "/health";
}
```

### Pino transports

Logs are shipped to MongoDB via `pino-mongodb` (durable storage) and to stdout via `pino-pretty` in development. The transports run in a worker thread, so logging never blocks the request path:

```ts
// src/Ship/logger.ts
const targets: pino.TransportTargetOptions[] = [
	{
		target: "pino-mongodb",
		level: process.env.LOG_LEVEL ?? "info",
		options: {
			uri: process.env.MONGO_URL,
			database: process.env.LOG_DB_NAME ?? "logs",
			collection: process.env.LOG_COLLECTION ?? "app_logs",
		},
	},
];

if (process.env.NODE_ENV !== "production") {
	targets.push({
		target: "pino-pretty",
		level: process.env.LOG_LEVEL ?? "debug",
		options: { colorize: true },
	});
}
```

## Prometheus metrics

### The endpoint

```
GET /api/metrics
```

Returns `text/plain` in Prometheus exposition format. No auth, no rate limiting:

```txt
# HELP thalys_requests_total Total HTTP requests
# TYPE thalys_requests_total counter
thalys_requests_total{method="GET",status="200"} 142
thalys_requests_total{method="POST",status="201"} 12
thalys_requests_total{method="GET",status="404"} 3
# HELP thalys_request_duration_ms Request duration in milliseconds
# TYPE thalys_request_duration_ms histogram
thalys_request_duration_ms_bucket{method="GET",le="1"} 50
thalys_request_duration_ms_bucket{method="GET",le="5"} 120
thalys_request_duration_ms_bucket{method="GET",le="10"} 135
thalys_request_duration_ms_bucket{method="GET",le="50"} 140
thalys_request_duration_ms_bucket{method="GET",le="100"} 141
thalys_request_duration_ms_bucket{method="GET",le="500"} 142
thalys_request_duration_ms_bucket{method="GET",le="1000"} 142
thalys_request_duration_ms_bucket{method="GET",le="+Inf"} 142
thalys_request_duration_ms_sum{method="GET"} 234.5
thalys_request_duration_ms_count{method="GET"} 142
```

### MetricsRegistry

A lightweight Prometheus-compatible registry with three metric types — counter, gauge, and histogram. No external dependency:

```ts
// src/Ship/Observability/metrics.ts
const DEFAULT_BUCKETS = [1, 5, 10, 50, 100, 500, 1000, Infinity];

export class MetricsRegistry {
	counter(name: string, value: number, labels: Labels = {}, help?: string): void { /* ... */ }
	gauge(name: string, value: number, labels: Labels = {}, help?: string): void { /* ... */ }
	histogram(name: string, value: number, labels: Labels = {}, buckets?: number[], help?: string): void { /* ... */ }
	format(): string { /* Prometheus text exposition */ }
	reset(): void { /* for tests */ }
}

export const metricsRegistry = new MetricsRegistry();
```

| Method | Description |
| --- | --- |
| `counter(name, value, labels, help)` | Monotonically increasing value (e.g. request count) |
| `gauge(name, value, labels, help)` | Value that can go up or down (e.g. active connections) |
| `histogram(name, value, labels, buckets, help)` | Distribution of values (e.g. request duration) |

Labels are sorted alphabetically to produce consistent keys. The `format()` method outputs the standard Prometheus text exposition format with `# HELP` and `# TYPE` comments.

### Request metrics plugin

The `requestMetricsPlugin` increments a counter and records a histogram for every request (except `/api/health` and `/api/metrics` themselves):

```ts
// src/Ship/Observability/requestMetrics.ts
const DURATION_BUCKETS = [1, 5, 10, 50, 100, 500, 1000, Infinity];

export function requestMetricsPlugin(registry: MetricsRegistry) {
	return new Elysia({ name: "request-metrics" })
		.derive({ as: "global" }, () => ({ _metricsStartedAt: Date.now() }))
		.onAfterHandle({ as: "global" }, (ctx) => { recordMetrics(registry, ctx); })
		.onError({ as: "global" }, (ctx) => { recordMetrics(registry, ctx); });
}

function recordMetrics(registry: MetricsRegistry, ctx): void {
	const duration = start !== undefined ? Date.now() - start : 0;
	const status = /* parse status */;

	// Skip infrastructure endpoints
	if (path === "/api/health" || path === "/api/metrics") return;

	registry.counter("thalys_requests_total", 1, { method, status: String(status) }, "Total HTTP requests");
	registry.histogram("thalys_request_duration_ms", duration, { method }, DURATION_BUCKETS, "Request duration in milliseconds");
}
```

Two metrics are recorded per request:

| Metric | Type | Labels | Description |
| --- | --- | --- | --- |
| `thalys_requests_total` | counter | `method`, `status` | Total HTTP requests |
| `thalys_request_duration_ms` | histogram | `method` | Request duration in milliseconds |

The histogram buckets are `[1, 5, 10, 50, 100, 500, 1000, +Inf]` milliseconds.

### Wiring in index.ts

Both the metrics endpoint and the plugin are mounted in `src/index.ts`:

```ts
// src/index.ts
const app = new Elysia({ prefix: "/api" })
	.use(requestLoggerPlugin(logger))
	.use(requestMetricsPlugin(metricsRegistry))
	.use(healthCheckPlugin)
	.get("/metrics", () => {
		const text = metricsRegistry.format();
		return new Response(text, {
			headers: { "content-type": "text/plain; version=0.0.4" },
		});
	})
	.use(swaggerPlugin)
	.use(authRoutesV1)
	.use(userRoutesV1)
```

## Error reporting

### The ErrorReporter interface

```ts
// src/Ship/Observability/ErrorReporter.ts
export interface ErrorReporter {
	capture(error: Error, context?: Record<string, unknown>): void;
}

export class ConsoleErrorReporter implements ErrorReporter {
	capture(error: Error, context?: Record<string, unknown>): void {
		console.error("[ErrorReporter]", error, context ?? {});
	}
}
```

The default `ConsoleErrorReporter` logs to stderr. It's registered in the container as `"ErrorReporter"`:

```ts
// src/Ship/Container/registerServices.ts
container.set<ErrorReporter>("ErrorReporter", new ConsoleErrorReporter());
```

### Only 5xx errors are reported

The global error handler in `setup.ts` calls `ErrorReporter.capture()` only for server errors (5xx). Client errors (4xx) are expected application flow — a `404 Not Found` or `403 Forbidden` is not a bug and should not pollute your error tracker:

```ts
// src/Ship/setup.ts (onError handler)
if (error instanceof APIError) {
	set.status = statusMap[error.status] ?? 500;
	if (set.status >= 500) {
		container.make<ErrorReporter>("ErrorReporter").capture(error as Error, { path: request.url });
	}
	return { success: false, error: "AUTH_ERROR", message: error.body?.message ?? error.message };
}

// Unhandled exceptions → always 5xx, always reported
set.status = 500;
container.make<ErrorReporter>("ErrorReporter").capture(error as Error, { path: request.url });
```

### Extension: Sentry / Loki integration

Implement `ErrorReporter` for your monitoring platform and bind it in the container:

```ts
import * as Sentry from "@sentry/node";
import type { ErrorReporter } from "@ship/Observability/ErrorReporter";

export class SentryErrorReporter implements ErrorReporter {
	capture(error: Error, context?: Record<string, unknown>): void {
		Sentry.captureException(error, { extra: context });
	}
}
```

Register it:

```ts
// In registerServices.ts:
container.set<ErrorReporter>("ErrorReporter", new SentryErrorReporter());
```

No other code changes — the global error handler already resolves `"ErrorReporter"` from the container and calls `capture()` on 5xx errors.

::: tip The capture() method is synchronous
The `ErrorReporter.capture()` signature returns `void`, not `Promise<void>`. This is intentional — error reporting should never block the error response or cause a cascading failure if the monitoring service is down. Use fire-and-forget internally (e.g. Sentry's `captureException` is synchronous and queues the event internally).
:::
