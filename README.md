<div align="center">

# Thalys

**Production-grade API framework for Bun — Porto architecture, end-to-end type safety, zero `any`.**

[![Bun](https://img.shields.io/badge/runtime-Bun-000000?style=flat-square&logo=bun)](https://bun.sh)
[![ElysiaJS](https://img.shields.io/badge/HTTP-ElysiaJS-000000?style=flat-square)](https://elysiajs.com)
[![Drizzle](https://img.shields.io/badge/ORM-Drizzle-000000?style=flat-square)](https://orm.drizzle.team)
[![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-MIT-000000?style=flat-square)](LICENSE)

</div>

---

Thalys wraps [ElysiaJS](https://elysiajs.com) with an opinionated developer experience and enforces a **Porto-style container architecture** — every domain in your application is an isolated, swappable module with a predictable internal layering. Built on [Bun](https://bun.sh), [Drizzle ORM](https://orm.drizzle.team), and strict TypeScript.

## Why Thalys?

Most API frameworks force a choice: a micro-framework that leaves structure to you (six months later, every team has reinvented a different "where does logic live"), or a full-stack framework so rigid that swapping one piece means fighting the framework.

Thalys takes a third path:

- **Opinionated core** — Porto container layout, Action → Task → Transformer flow, DI container, request pipeline, and error envelope are non-negotiable. Every project looks structurally identical.
- **Escape hatches** — Cache, queue, rate limiting, auth, and error reporting are all behind port interfaces. Swap Redis for Memcached, or Better Auth for a remote auth microservice — one binding change, zero consumer code changes.
- **Designed for extraction** — Each container is self-contained. Promote a Bridge adapter from in-process calls to HTTP calls to split a monolith into services — without rewriting the consumer.

## Quick start

```bash
# Clone
git clone https://github.com/ahmadhafizh16/thalys-framework.git my-api
cd my-api
bun install

# Configure environment
cp .env.example .env
# → set APP_DATABASE_URL, MONGO_URL, REDIS_URL

# Run migrations
bun run db:migrate

# Start the server
bun run dev
```

The server starts on `http://localhost:3000` with:
- Swagger docs at `/api/swagger`
- Health check at `/api/health`
- Prometheus metrics at `/api/metrics`

## Architecture

```
src/
  Ship/                          # Shared infrastructure (the opinionated core)
    Http/                        # routeGroup, authContext, can(), rate limiting
    Container/                   # DI container (set/bind/register/make)
    Console/                     # CLI kernel with signature parsing
    database/                    # Drizzle/Postgres connection
    Cache/  Queue/  Events/      # Interface-first swappable drivers
    Generators/                  # Code scaffolding (make:container, make:action, ...)
    Exceptions/                  # AppError hierarchy + global handler
    Observability/               # Metrics, error reporter
    TestHelpers/                 # RequestTester, mockAuth, withTestTransaction

  Containers/                    # Isolated business domains
    User/                        #   → UI/API/Controllers/ + routes.ts
    Auth/                        #   → Actions/ → Tasks/ → Models/
    AuthBridge/                  #   → Bridge port + adapter
    RolesBridge/
```

### Request flow

```
HTTP Request
  → routeGroup()                    shipContext + authContext + rate limiting
  → TypeBox body validation         Elysia built-in
  → beforeHandle: [can("user","read")]   RBAC guard
  → controller function             UI/API/Controllers/*.ts
  → Action.execute()                transaction boundary (db.transaction)
  → Task.run()                      single DB operation
  → Transformer.transform()         client-facing shape
  → wrapResponse(data)              { data, meta }
```

### The Porto layers

| Layer | Responsibility |
|---|---|
| **routes.ts** | Thin wiring — paths, body schemas, `can()` guards. No handler logic. |
| **Controllers/** | One async function per file. Calls Actions, transforms result, returns `wrapResponse()`. |
| **Requests/** | TypeBox schemas for body validation + allowlist-driven query parsing. |
| **Actions/** | Transaction boundary. Opens `db.transaction()`, orchestrates Tasks. Instance-based, DI-injected. |
| **Tasks/** | Single DB/system operation. Never calls another Task or Action. |
| **Models/** | Drizzle `pgTable` schemas + `BaseRepository<T>` with pagination. |
| **Transformers/** | Explicit client-facing shape — internal columns never leak. |

### Bridge containers (cross-domain isolation)

A container never imports another container's internals. Cross-domain communication goes through a **Bridge** — a separate container holding a Port interface + DTOs + an adapter that calls the producer's Actions.

```
Containers/
  Auth/              # producer — owns internals
  AuthBridge/        # bridge — owns external contract (Port + DTOs)
    Adapters/InProcessAuthBridgeAdapter.ts   # calls Auth's Actions directly
  User/              # consumer — imports AuthBridge Port, never Auth internals
```

Swap `InProcessAuthBridgeAdapter` for `HttpAuthBridgeAdapter` → Auth becomes a microservice. Zero consumer changes.

## CLI commands

```bash
bun run command --help                          # list all commands

# Scaffold a full CRUD container (14 files: model, repo, requests, actions, controllers, routes)
bun run command thalys:make:container Product --crud

# Individual generators
bun run command thalys:make:action User CreateOrder
bun run command thalys:make:task User CalculateTax
bun run command thalys:make:controller User createOrder
bun run command thalys:make:middleware RateLimit
bun run command thalys:make:factory User

# Database
bun run command db:migrate                      # apply migrations
bun run command db:generate                     # generate from schema changes
bun run command db:seed:roles                   # seed RBAC roles + permissions
bun run command db:seed:users --count 50        # seed fake users

# Background jobs
bun run command thalys:work                     # start queue worker
```

## Example: a controller function

```ts
// src/Containers/User/UI/API/Controllers/createUser.ts
import { CreateUserAction } from "@containers/User/Actions/CreateUserAction";
import type { CreateUserDTO } from "@containers/User/Requests/user.request";
import { UserTransformer } from "@containers/User/Transformers/UserTransformer";
import type { Container } from "@ship/Container/Container";
import { wrapResponse } from "@ship/Http/MainController";

const transformer = new UserTransformer();

export async function createUser(body: CreateUserDTO, container: Container) {
  const action = container.make(CreateUserAction);
  const created = await action.execute(body);
  return wrapResponse(transformer.transform(created));
}
```

```ts
// src/Containers/User/UI/API/v1/routes.ts — thin wiring
import { createUser } from "@containers/User/UI/API/Controllers/createUser";
import { can } from "@ship/Http/canMiddleware";
import { routeGroup } from "@ship/Http/routeGroup";

export const userRoutesV1 = routeGroup("/v1/users")
  .post("/", async ({ container, body, set }) => {
    set.status = 201;
    return createUser(body, container as Container);
  }, { body: CreateUserRequest })
  .get("/", async ({ container, query }) => listUsers(query, container as Container),
    { beforeHandle: [can("user", "read")] });
```

## Key features

<details>
<summary><strong>Dependency Injection</strong></summary>

~50-line custom container. `bind` for auto-wire (90% of cases), `register` for custom factories. Singletons by default. No `reflect-metadata` — explicit dependency arrays.

```ts
container.bind(UserRepository, "db");
container.bind(CreateUserAction, "db", UserRepository);
const action = container.make(CreateUserAction);  // auto-resolved
```
</details>

<details>
<summary><strong>RBAC with permission allowlists</strong></summary>

```ts
// Route-level guard
{ beforeHandle: [can("user", "read")] }

// Wildcard support
{ beforeHandle: [can("*", "*")] }        // admin
{ beforeHandle: [can("user", "*")] }     // all user operations
```

Query params are parsed against a per-endpoint static allowlist — unknown filterable fields return 400, preventing SQL injection via column names.
</details>

<details>
<summary><strong>Swappable drivers</strong></summary>

```ts
// One env var swaps all three: cache, queue, rate limiter
REDIS_URL=redis://localhost:30002   // → Redis drivers
// (omitted)                          // → in-memory drivers (dev/test)
```

| Interface | In-memory | Redis |
|---|---|---|
| `CacheStore` | `InMemoryCacheStore` | `RedisCacheStore` |
| `QueueDriver` | `InMemoryQueueDriver` | `RedisQueueDriver` |
| `RateLimitStore` | `InMemoryRateLimitStore` | `RedisRateLimitStore` |
</details>

<details>
<summary><strong>Events (fire-and-forget)</strong></summary>

```ts
// Fire an event after transaction commit
eventDispatcher.dispatch(new InvoiceCreatedEvent(invoice));

// Listeners run async, independently
class EmailListener implements Listener {
  channel = "invoice.created";
  async handle(event: InvoiceCreatedEvent) {
    await this.emailService.send(event.invoice.email);
  }
}
```

Producer doesn't know who listens. Listener failures don't roll back the producer's work.
</details>

<details>
<summary><strong>Observability</strong></summary>

- **Structured logging** — Pino with MongoDB sink (hit-and-run: logging failures never roll back app DB work)
- **Metrics** — Prometheus-format counters, gauges, histograms at `/api/metrics`
- **Error reporting** — Pluggable `ErrorReporter` port (console default, Sentry-ready)
- **Profiling** — Per-request query counter via `wrapDbWithQueryCounter()`
</details>

<details>
<summary><strong>Internationalization</strong></summary>

Built-in i18n with `en`/`ar` catalogs. Error messages are localized automatically via `Accept-Language` header.

```ts
const message = lz("errors.NOT_FOUND", locale, { resource: "User" });
```
</details>

<details>
<summary><strong>Testing</strong></summary>

```ts
// Unit test a controller function directly — no Elysia needed
const result = await createUser(validBody, mockContainer);
expect(result.data).toBeDefined();

// Integration test through the real HTTP pipeline
const tester = new RequestTester(app);
const res = await tester.get("/api/v1/users/123", { token: adminToken });
expect(res.status).toBe(200);

// Per-test rollback with real Postgres
await withTestTransaction(db, async (tx) => {
  await repo.withTransaction(tx).create(userData);
  // auto-rolled-back after test
});
```
</details>

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | [Bun](https://bun.sh) >= 1.1 |
| HTTP | [ElysiaJS](https://elysiajs.com) |
| Database | PostgreSQL 14+ |
| ORM | [Drizzle ORM](https://orm.drizzle.team) |
| Auth | [Better Auth](https://better-auth.com) (bearer tokens, wrapped behind Bridge) |
| Cache / Queue / Rate limit | Redis (optional, in-memory fallback) |
| Logging | [Pino](https://getpino.io) + `pino-mongodb` |
| Validation | TypeBox (Elysia-native) |
| Linting | [Biome](https://biomejs.dev) |
| Docs | [VitePress](https://vitepress.dev) |

## Scripts

```bash
bun run dev              # watch-mode server
bun run start            # run once
bun run command          # CLI
bun run test             # test suite
bun run typecheck        # tsc --noEmit (authoritative)
bun run lint             # biome check
bun run lint:fix         # biome check --write
bun run db:generate      # generate SQL migration
bun run db:migrate       # apply migrations
bun run docs:dev         # VitePress dev server
```

## Documentation

Full docs site available at [`docs/`](./docs) — run locally with `bun run docs:dev`.

- [Getting Started](./docs/getting-started/introduction.md)
- [Architecture](./docs/architecture/overview.md)
- [CLI Reference](./docs/cli/make-container.md)
- [Guides](./docs/guides/auth-setup.md)

## License

MIT
