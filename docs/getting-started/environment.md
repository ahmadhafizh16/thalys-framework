# Environment Setup

Thalys is configured entirely through environment variables loaded from a `.env` file in the project root. This page documents every variable, what it controls, and what happens when it is missing.

## Copying the example file

The repository ships a `.env.example` with sane defaults for the SSH-tunnel dev setup. Start by copying it:

```bash
cp .env.example .env
```

`.env` is gitignored — it never gets committed. Edit the values to match your tunnel and credentials.

Here is the full example for reference:

```bash
# App
PORT=3000

# PostgreSQL (App DB / AppDb) — forwarded from remote 5432 via SSH (LocalForward 30001)
APP_DATABASE_URL=postgres://ahmad:supersecret_pg@localhost:30001/thalys

# MongoDB (logs via pino-mongodb) — forwarded from remote 27017 via SSH (LocalForward 30003)
MONGO_URL=mongodb://ahmad:supersecret_mongo@127.0.0.1:30003/?authSource=admin
LOG_DB_NAME=logs
LOG_COLLECTION=app_logs
LOG_LEVEL=info

# Redis — forwarded from remote 6379 via SSH (LocalForward 30002). Not wired up yet.
REDIS_URL=redis://localhost:30002
```

## Every environment variable

### Application

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PORT` | no | `3000` | The port the Elysia HTTP server listens on. Read in `src/index.ts` via `process.env.PORT ?? 3000`. |
| `NODE_ENV` | no | — | When set to `production`, Pino switches from `pino-pretty` to JSON output, and the Swagger docs route is disabled unless `ENABLE_SWAGGER=true`. |
| `LOG_LEVEL` | no | `info` | Pino log level. One of `trace`, `debug`, `info`, `warn`, `error`, `fatal`. |

### Database

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `APP_DATABASE_URL` | **yes** | `postgres://localhost:30001/appdb` | PostgreSQL connection string for the primary application database. Uses the `postgres` driver under Drizzle. In dev, the host is `localhost:30001` (the SSH tunnel forward). |

::: warning Server will not boot without a database
`Ship/database/connection.ts` opens the Postgres pool at module load. If `APP_DATABASE_URL` points at an unreachable host, `bun run dev` crashes immediately with `connect ECONNREFUSED`. Bring up the SSH tunnel first — see [Installation: the dev server tunnel setup](./installation#the-dev-server-tunnel-setup).
:::

### Logging (MongoDB)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `MONGO_URL` | **yes** | — | MongoDB connection string used by `pino-mongodb` to stream structured logs. In dev, `localhost:30003` with `authSource=admin`. |
| `LOG_DB_NAME` | no | `logs` | The MongoDB database name logs are written to. |
| `LOG_COLLECTION` | no | `app_logs` | The MongoDB collection name logs are written to. |
| `LOG_LEVEL` | no | `info` | (Same as above — controls Pino verbosity.) |

::: tip Logging is hit-and-run
The Pino logger writes to MongoDB asynchronously. If MongoDB is temporarily unreachable, logging failures **must not** roll back application database work — the logger is wired so that a logging error never throws into a request's transaction path. Application DB work and log writes are decoupled by design.
:::

### Redis (cache, queue, rate limiting)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `REDIS_URL` | no | — | Redis connection string. When present, Thalys wires Redis-backed implementations for cache, queue, and rate limiting. In dev, `redis://localhost:30002`. |

::: tip REDIS_URL is optional
This is the most important "escape hatch" in the dev environment. **When `REDIS_URL` is not set, nothing breaks** — Thalys silently falls back to in-memory implementations. See [What happens when REDIS_URL is not set](#what-happens-when-redis-url-is-not-set) below.
:::

### Auth (social providers — optional)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `GOOGLE_CLIENT_ID` | no | — | Google OAuth client ID. Enables Google social sign-in when set. |
| `GOOGLE_CLIENT_SECRET` | no | — | Google OAuth client secret. Pair with `GOOGLE_CLIENT_ID`. |
| `GITHUB_CLIENT_ID` | no | — | GitHub OAuth client ID. Enables GitHub social sign-in when set. |
| `GITHUB_CLIENT_SECRET` | no | — | GitHub OAuth client secret. Pair with `GITHUB_CLIENT_ID`. |

These are read by the Better Auth configuration in `src/Containers/Auth/betterAuth.config.ts`. If neither pair is set, social providers are simply not registered — email/password and bearer-token auth still work.

### Docs

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `ENABLE_SWAGGER` | no | — | Forces the Swagger docs UI on even when `NODE_ENV=production`. By default, `@elysiajs/swagger` is mounted in non-production environments only. Set to `true` to override and expose `/api/swagger` in prod (use with care). |

## What happens when REDIS_URL is not set

This is the cleanest demonstration of Thalys's interface-first infrastructure design. The service container in `src/Ship/Container/registerServices.ts` checks `process.env.REDIS_URL` once at boot and wires the matching implementation:

```ts
// src/Ship/Container/registerServices.ts
// Cache — Redis if REDIS_URL is set, otherwise in-memory
const cache = process.env.REDIS_URL
	? new RedisCacheStore(process.env.REDIS_URL)
	: new InMemoryCacheStore();
container.set("cache", cache);

// Queue — Redis if REDIS_URL is set, otherwise in-memory
const queue = process.env.REDIS_URL
	? new RedisQueueDriver(process.env.REDIS_URL)
	: new InMemoryQueueDriver();
container.set("queue", queue);

// Rate limiting — Redis if REDIS_URL is set, otherwise in-memory
const rateLimitStore = process.env.REDIS_URL
	? new RedisRateLimitStore(process.env.REDIS_URL)
	: new InMemoryRateLimitStore();
container.set("rateLimitStore", rateLimitStore);
```

| Infrastructure | `REDIS_URL` set | `REDIS_URL` unset |
| --- | --- | --- |
| Cache | `RedisCacheStore` — shared across processes | `InMemoryCacheStore` — per-process LRU |
| Queue | `RedisQueueDriver` — durable, cross-process | `InMemoryQueueDriver` — loses jobs on restart |
| Rate limiting | `RedisRateLimitStore` — accurate across replicas | `InMemoryRateLimitStore` — per-process only |

The business code that consumes these (`remember()`, `queue.push()`) is identical in both cases — it resolves the port from the container and calls interface methods. The rate-limit store is wired into `routeGroup()` (`src/Ship/Http/routeGroup.ts`), which applies it to every route group automatically; route files no longer import `rateLimitMiddleware` directly. You develop locally with zero Redis, then add `REDIS_URL=redis://prod-redis:6379` in production to get distributed behavior with no code change.

::: warning In-memory is for dev only
`InMemoryQueueDriver` stores jobs in a JavaScript array. If the process restarts (or in a multi-replica deployment), queued jobs are lost. Always set `REDIS_URL` in staging and production.
:::

## The SSH tunnel explanation

Every dev service URL points at `localhost` on a non-standard port. This is not a coincidence — it is the SSH tunnel pattern described in [Installation](./installation#the-dev-server-tunnel-setup). The mapping is fixed across the whole project:

| Service | `.env` host | Tunnel local port | Remote port |
| --- | --- | --- | --- |
| PostgreSQL | `localhost:30001` | 30001 | 5432 |
| Redis | `localhost:30002` | 30002 | 6379 |
| MongoDB | `localhost:30003` | 30003 | 27017 |

Because the ports are baked into `.env.example` and the tunnel `LocalForward` directives, **every developer uses the same `.env`**. The only per-developer secret is the SSH key that opens the tunnel. This is why `.env.example` ships with real-looking `localhost:3000x` URLs rather than placeholder hostnames.

When you deploy to production, you replace these with the real service hosts (e.g. `postgres://prod-db.internal:5432/thalys`) — the tunnel is a dev-only convenience.

## Verifying your environment

With `.env` in place and the tunnel up, a quick smoke test:

```bash
# Database reachable?
psql "$(grep APP_DATABASE_URL .env | cut -d= -f2-)" -c 'select version()'

# Mongo reachable?
# (any mongo client, or just boot the server and check for log errors)

# Server boots?
bun run dev
# → 🦊 Elysia running on Bun  host=localhost port=3000

# Health endpoint?
curl http://localhost:3000/api/health
```

If the health endpoint returns JSON, your environment is correctly configured. Proceed to [Your First Container](./first-container).
