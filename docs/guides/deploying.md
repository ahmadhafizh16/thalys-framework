# Deploying

This guide covers building and running Thalys in production: environment variables, migrations, the queue worker, graceful shutdown, health checks for orchestrators, and a Docker deployment example.

## Building for production

Thalys runs on the Bun runtime. There is no separate build step — Bun executes TypeScript directly. To start the server in production mode:

```bash
bun run start
```

This runs `bun src/index.ts` without watch mode. The `dev` script (`bun --watch src/index.ts`) is for development only — it restarts on file changes, which you don't want in production.

## Environment variables

Create a `.env` file (or inject environment variables via your orchestrator) with production values:

```bash
# App
NODE_ENV=production
PORT=3000
APP_URL=https://api.example.com

# PostgreSQL — direct connection (no SSH tunnel in production)
APP_DATABASE_URL=postgres://user:password@db-host:5432/thalys

# MongoDB — for Pino structured logs
MONGO_URL=mongodb://user:password@mongo-host:27017/?authSource=admin
LOG_DB_NAME=logs
LOG_COLLECTION=app_logs
LOG_LEVEL=info

# Redis — enables distributed cache, queue, and rate limiting
REDIS_URL=redis://redis-host:6379

# Social auth (optional)
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret

# Swagger (optional — disabled in production by default)
ENABLE_SWAGGER=false
```

### What changes from development

| Setting | Development | Production |
| --- | --- | --- |
| `NODE_ENV` | unset (or `development`) | `production` |
| Database host | `localhost:30001` (SSH tunnel) | Direct `db-host:5432` |
| Redis host | `localhost:30002` (SSH tunnel) | Direct `redis-host:6379` |
| MongoDB host | `localhost:30003` (SSH tunnel) | Direct `mongo-host:27017` |
| Swagger | Enabled | Disabled (override with `ENABLE_SWAGGER=true`) |
| Profiler | Active | No-op |
| Logger (stdout) | `pino-pretty` (colorized) | JSON only (to MongoDB) |

::: tip SSH tunnel is not needed in production
Local dev uses an SSH tunnel to reach remote databases on non-standard ports (`localhost:30001`, etc.). In production, the database runs in the same network (or VPC) — connect directly to the standard ports. No tunnel, no `LocalForward`.
:::

### Swagger docs

Swagger UI is disabled in production by default. The check is simple:

```ts
// src/Ship/Http/swaggerPlugin.ts
const enabled = process.env.NODE_ENV !== "production" || process.env.ENABLE_SWAGGER === "true";

export const swaggerPlugin = enabled
	? swagger({ path: "/docs", /* ... */ })
	: new Elysia({ name: "swagger:off" });
```

To force-enable Swagger in production (e.g. for a staging environment):

```bash
ENABLE_SWAGGER=true
```

### The profiler is a no-op

In development, the profiler plugin tracks request duration, DB query count, and memory delta, injecting a `_profile` field into the response `meta`. In production, it returns an empty Elysia instance — zero overhead:

```ts
// src/Ship/Http/profiler.ts
const isProduction = process.env.NODE_ENV === "production";

export const profilerPlugin = isProduction
	? new Elysia({ name: "profiler:off" })  // no-op
	: new Elysia({ name: "profiler" })      // active
			.derive({ as: "global" }, () => { /* ... */ })
			.onAfterHandle({ as: "global" }, (ctx) => { /* ... */ });
```

## Running migrations

Always run migrations **before** starting the server. New code may depend on schema changes that haven't been applied yet:

```bash
bun run db:migrate
```

This runs `drizzle-kit migrate`, which applies any pending SQL migration files from `drizzle/` in order. Each migration is recorded in the `__drizzle_migrations` table, so re-running is safe (it skips already-applied migrations).

To check migration status without applying:

```bash
bun run command db:status
```

## Seeding roles

After migrations, seed the default RBAC roles:

```bash
bun run command db:seed:roles
```

This creates `admin` (with `*/*` permissions), `customer`, and `seller` roles. The seeder is idempotent — it skips roles and permissions that already exist. Run it on every deploy to ensure new permissions are added.

## Starting the queue worker

The queue worker is a **separate process** from the HTTP server. It consumes background jobs (emails, report generation, etc.) without blocking HTTP responses:

```bash
bun run command thalys:work
```

The worker resolves the queue driver from the container (Redis in production), registers a handler that deserializes jobs via `JobRegistry`, and runs until `SIGINT`:

```ts
// src/Ship/Queue/WorkCommand.ts
async handle(input: WorkInput, context: ConsoleContext): Promise<void> {
	const queueDriver = context.container.make("queue" as never) as QueueDriver;

	context.log.info({ queue: input.queue }, "Worker started");

	queueDriver.process(async (job) => {
		const instance = jobRegistry.resolve(job.job);
		try {
			await instance.handle(job.payload);
			context.log.info({ job: job.job, id: job.id }, "Job completed");
		} catch (error) {
			context.log.error({ job: job.job, id: job.id, error }, "Job failed");
			throw error;  // driver handles retry/backoff
		}
	});

	await new Promise<void>((resolve) => {
		process.on("SIGINT", async () => {
			context.log.info("Worker shutting down...");
			await queueDriver.stop();
			if (queueDriver instanceof RedisQueueDriver) {
				await queueDriver.disconnect();
			}
			resolve();
		});
	});
}
```

::: tip Process management
Run **one HTTP server** and **one queue worker**. Scale them independently:
- HTTP server: scale horizontally based on request volume.
- Queue worker: scale based on queue depth. One worker is often enough; add more if jobs back up.

If you run multiple workers, each creates its own Redis connection for `BLPOP`. Redis handles multiple consumers on the same list safely (each job is consumed by exactly one worker).
:::

## Graceful shutdown

Both the HTTP server and the worker handle `SIGINT` and `SIGTERM`. The HTTP server disconnects Redis and stops the Elysia instance:

```ts
// src/index.ts
const shutdown = async (signal: string) => {
	logger.info({ signal }, "Shutting down");
	const cache = container.make("cache" as never) as unknown;
	if (cache instanceof RedisCacheStore) await cache.disconnect();
	await app.stop();
	process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
```

The worker stops polling and disconnects its Redis connection:

```ts
// WorkCommand — SIGINT handler:
await queueDriver.stop();
if (queueDriver instanceof RedisQueueDriver) {
	await queueDriver.disconnect();
}
```

::: warning Allow 10-30 seconds for graceful shutdown
Orchestrators (Kubernetes, Docker) send `SIGTERM` and wait a grace period (default 10s in Docker, 30s in K8s) before sending `SIGKILL`. Ensure your grace period is long enough for in-flight requests to complete and Redis connections to close. In Kubernetes, set `terminationGracePeriodSeconds: 30`.
:::

## Health check for orchestrators

Orchestrators should probe `GET /api/health` to determine if the server is ready to receive traffic:

```bash
curl http://localhost:3000/api/health
# 200 → healthy, route traffic
# 503 → unhealthy, stop routing / restart
```

The health check runs `SELECT 1` against Postgres and `PING` against Redis (if configured). No auth, no rate limiting — it's designed to be polled every 10-15 seconds.

Kubernetes example:

```yaml
livenessProbe:
  httpGet:
    path: /api/health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
readinessProbe:
  httpGet:
    path: /api/health
    port: 3000
  initialDelaySeconds: 3
  periodSeconds: 5
```

## Metrics for Prometheus

Point your Prometheus scraper at `GET /api/metrics`:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: "thalys"
    metrics_path: /api/metrics
    static_configs:
      - targets: ["api-host:3000"]
```

The endpoint returns Prometheus text exposition format with `thalys_requests_total` (counter) and `thalys_request_duration_ms` (histogram).

## Docker deployment

A minimal Dockerfile for Thalys:

```dockerfile
FROM oven/bun:1.1 AS base

WORKDIR /app

# Install dependencies
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY . .

# Run migrations, seed roles, then start the server
# (do migrations in a separate step/entrypoint in real deployments)
CMD ["bun", "run", "start"]
```

Build and run:

```bash
docker build -t thalys-api .
docker run -p 3000:3000 --env-file .env.production thalys-api
```

For a two-process setup (HTTP + worker), use a process manager or run two containers:

```yaml
# docker-compose.yml
services:
  api:
    build: .
    ports:
      - "3000:3000"
    env_file: .env.production
    command: bun run start
    depends_on:
      - db
      - redis

  worker:
    build: .
    env_file: .env.production
    command: bun run command thalys:work
    depends_on:
      - db
      - redis

  db:
    image: postgres:16
    environment:
      POSTGRES_DB: thalys
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7

volumes:
  pgdata:
```

::: tip Run migrations as a one-shot container
Don't run migrations inside the HTTP server startup — if two instances start simultaneously, they'll race. Instead, run migrations as a separate container that exits before the API starts:

```bash
docker run --rm --env-file .env.production thalys-api bun run db:migrate
docker run --rm --env-file .env.production thalys-api bun run command db:seed:roles
```

In Kubernetes, use an `initContainer` or a Helm pre-install hook.
:::
