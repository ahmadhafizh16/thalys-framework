# Introduction

Thalys is a production-grade, enterprise-oriented framework for building type-safe APIs on **Bun**. It wraps [ElysiaJS](https://elysiajs.com) with a Laravel-style developer experience and enforces a **Porto-style container architecture** — so every domain in your application is an isolated, swappable module with a predictable internal layering.

If you have shipped APIs with Laravel, NestJS, or Django, Thalys will feel familiar: there is a console kernel with Artisan-style commands, a service container with dependency injection, a request pipeline with validation and middleware, and a migration workflow driven by [Drizzle ORM](https://orm.drizzle.team). The difference is that everything runs on the Bun runtime, the type system carries through every layer, and the architecture refuses to let one business domain reach into another's internals.

## What Thalys is built on

| Layer | Technology | Role in Thalys |
| --- | --- | --- |
| Runtime | **Bun** >= 1.1 | Process, bundler, test runner, script host |
| HTTP server | **ElysiaJS** | Routing, lifecycle hooks, schema-validated requests |
| Database | **PostgreSQL** 14+ | Primary application database (AppDb) |
| ORM | **Drizzle ORM** | Schema definitions, query builder, migrations |
| Auth | **Better Auth** | Session/tokens, wrapped behind a Bridge port |
| Cache / Queue / Rate limit | **Redis** (optional) | Swappable; in-memory fallbacks in dev |
| Logging | **Pino** + `pino-mongodb` | Structured logs shipped to MongoDB |

Thalys is not a thin wrapper around these libraries — it is an opinionated composition of them. Each integration point (auth, cache, queue, rate limiting, events, error reporting) sits behind a port interface registered in the DI container, so the concrete implementation can be swapped without touching business code.

## Why use Thalys

Most API frameworks force a choice between two failure modes:

1. **Micro-frameworks** give you a router and leave every structural decision to you. Six months in, every team has reinvented a different, incompatible version of "where does the business logic live."
2. **Full-stack frameworks** impose a single, rigid module system. Cross-cutting concerns (auth, events, caching) are baked into the core, and swapping one means fighting the framework.

Thalys takes a third path with a **layered philosophy**:

- **An opinionated core.** The Porto container layout, the Action → Task → Transformer flow, the DI container, the request pipeline, and the error envelope are non-negotiable. Every Thalys project looks structurally identical, so engineers move between domains without re-learning conventions.
- **Escape hatches where it matters.** Infrastructure is interface-first. Cache, queue, rate limiting, auth, and error reporting are all ports resolved from the container. The default implementations are good enough for production, but replacing Redis with Memcached, or Better Auth with a remote auth microservice, is a one-binding change.
- **Composable pieces.** Each container is self-contained. You can extract a container into its own package, or split a monolith into services by promoting a Bridge adapter from in-process calls to HTTP calls — without rewriting the consumer.

## The layered philosophy in practice

```txt
┌─────────────────────────────────────────────────────────┐
│  src/index.ts  ←  Elysia app, mounts all route groups   │
├─────────────────────────────────────────────────────────┤
│  Ship/  — shared infrastructure (the opinionated core)  │
│    database/  Http/  Cache/  Queue/  Events/  Console/  │
│    Container/  Exceptions/  Observability/  setup.ts    │
│    (Http/routeGroup.ts assembles the middleware stack)  │
├─────────────────────────────────────────────────────────┤
│  Containers/<Domain>/  — isolated business domains      │
│    UI/API/Controllers/  →  plain async functions         │
│    UI/API/v1/routes.ts  →  thin wiring via routeGroup() │
│    Requests  →  Actions  →  Tasks  →  Models            │
│                                →  Transformers           │
├─────────────────────────────────────────────────────────┤
│  Containers/<Domain>Bridge/  — cross-domain contracts   │
│    DTOs/  Adapters/  (port interface)                   │
└─────────────────────────────────────────────────────────┘
```

`Ship` owns infrastructure and is the only layer that may be imported by any container. `Containers` own business behavior and may never import another container's Tasks, Models, or Transformers directly — cross-domain communication goes through a **Bridge container** that exposes a port interface.

## Before you start

You will need the following on your machine before building with Thalys:

| Requirement | Version | Notes |
| --- | --- | --- |
| **Bun** | >= 1.1 | Runtime, test runner, package manager |
| **PostgreSQL** | 14+ | Primary database. Local dev typically reaches it over an SSH tunnel. |
| **Redis** | 6+ | Optional. Enables distributed cache, queues, and rate limiting. Without it, Thalys falls back to in-memory implementations. |
| **MongoDB** | 4.4+ | Used by the Pino logger (`pino-mongodb`) for structured log storage. |

::: tip No Redis in dev
You can build and run Thalys locally with zero Redis. The `REDIS_URL` env var is optional. When unset, the service container wires `InMemoryCacheStore`, `InMemoryQueueDriver`, and `InMemoryRateLimitStore` automatically. Promote to Redis only when you need cross-process behavior.
:::

## Project structure overview

A fresh Thalys project has two top-level source directories under `src/`:

```txt
src/
├── index.ts                 # Elysia entrypoint — mounts route groups, health, metrics, swagger
├── command.ts               # Console entrypoint — boots the CLI kernel without the HTTP server
├── Ship/                    # Shared infrastructure (the framework core)
│   ├── setup.ts             # shipContext: decorates routes with db/log/container + global error handler
│   ├── database/            # Drizzle connection, AppDB/AppTx/AppClient types
│   ├── Container/           # DI container + registerServices() (all bindings live here)
│   ├── Http/                # Request pipeline: auth, RBAC, rate limiting, profiling, swagger
│   ├── Cache/               # CacheStore port + Redis/InMemory implementations
│   ├── Queue/               # QueueDriver port + Redis/InMemory implementations + worker
│   ├── Events/              # BaseEvent + EventDispatcher (in-process pub/sub)
│   ├── Exceptions/          # AppError hierarchy (NotFoundError, ConflictError, ...)
│   ├── Observability/       # Prometheus metrics registry + ErrorReporter port
│   ├── Repository/          # BaseRepository<T> — cursor pagination, CRUD, filter/sort
│   ├── Generators/          # thalys:make:* commands + stub templates
│   ├── Console/             # Artisan-style CLI kernel, context, command contract
│   └── logger.ts            # Pino logger (MongoDB + pino-pretty)
└── Containers/              # Isolated business domains
    ├── Auth/                # Authentication (Better Auth) — producer
    ├── AuthBridge/          # Bridge: AuthBridgePort for Ship middleware
    ├── RolesBridge/         # Bridge: RolesBridgePort for role lookups
    └── User/                # User domain — full CRUD example
```

Every container follows the same internal layout:

```txt
Containers/Product/
├── Models/
│   ├── product.schema.ts    # Drizzle pgTable — the single source of truth for types
│   └── ProductRepository.ts # extends BaseRepository<typeof productsTable>
├── Requests/                # TypeBox input schemas (create, update, list query)
├── Actions/                 # Transactional orchestration (Create, Update, Delete)
├── Tasks/                   # One DB/system operation each
├── Transformers/            # Client-facing response shaping (no internal columns leak)
└── UI/
    ├── API/
    │   ├── Controllers/     # One plain async function per endpoint (handler logic)
    │   └── v1/routes.ts     # Thin wiring: routeGroup() + delegate to controllers
    └── Command/             # Class-based console commands (seeders, etc.)
```

The request flow through a container is strictly one-directional:

```txt
HTTP request
  → UI/API/v1/routes.ts       (routeGroup() wires shipContext + authContext + rate limit)
    → Requests/                (TypeBox validation — the input type)
      → beforeHandle [can()]   (RBAC permission guard, per-route)
        → Controllers/         (plain async function: resolves Action, transforms, envelopes)
          → Actions/           (opens db.transaction, orchestrates Tasks)
            → Tasks/           (one DB operation each, accepts AppClient = db | tx)
            → Models/          (Drizzle schema + repository)
          → Transformers/      (maps Raw<Entity> → Safe<Entity>Output)
  → wrapResponse()             (envelopes result as { data, meta })
```

No layer may skip ahead. A route file never touches a Task — it delegates to a controller function, which in turn calls an Action. A Task never calls another Task. A Transformer never touches the database. This is what makes a Thalys codebase navigable: to understand any endpoint, you read exactly one file per layer.

## A quick hello world

The smallest possible Thalys route lives in a container's `UI/API/v1/routes.ts`. Even a trivial endpoint follows the same two-part shape as a full CRUD container: a **controller function** holds the logic, and `routes.ts` is thin wiring that calls `routeGroup()` and delegates.

First, the controller — a plain `async function` that returns `wrapResponse(...)`:

```ts
// src/Containers/Hello/UI/API/Controllers/hello.ts
import type { Container } from "@ship/Container/Container";
import { wrapResponse } from "@ship/Http/MainController";

export async function hello(container: Container) {
	container.log.info("hello endpoint hit");
	return wrapResponse({ message: "Hello from Thalys" });
}
```

Then the route file — `routeGroup()` assembles the middleware stack (`shipContext` + `authContext` + rate limiting) and the handler body just calls the controller:

```ts
// src/Containers/Hello/UI/API/v1/routes.ts
import { hello } from "@containers/Hello/UI/API/Controllers/hello";
import type { Container } from "@ship/Container/Container";
import { routeGroup } from "@ship/Http/routeGroup";

export const helloRoutesV1 = routeGroup("/v1/hello").get(
	"/",
	async ({ container }) => hello(container as Container),
);
```

Mount it in `src/index.ts` alongside the other route groups:

```ts
// src/index.ts
import { Elysia } from "elysia";
import { helloRoutesV1 } from "./Containers/Hello/UI/API/v1/routes";
import { healthCheckPlugin } from "./Ship/Http/healthCheck";
import { logger } from "./Ship/logger";
import { container } from "./Ship/setup";

const app = new Elysia({ prefix: "/api" })
	.use(healthCheckPlugin)
	.use(helloRoutesV1)
	.listen(process.env.PORT ?? 3000);

logger.info({ port: app.server?.port }, "🦊 Elysia running on Bun");
```

Start the server:

```bash
bun run dev
```

And curl it:

```bash
curl http://localhost:3000/api/v1/hello
```

```json
{
  "data": {
    "message": "Hello from Thalys"
  },
  "meta": {}
}
```

Notice four things about even this trivial example:

1. **The response is enveloped.** `wrapResponse()` produces `{ data, meta }` — every Thalys endpoint returns this shape, so clients can parse responses uniformly.
2. **`routeGroup()` replaces the boilerplate.** A single call wires `shipContext` (injects `db`/`log`/`container` and registers the global error handler), `authContext` (loads `currentUser`), and the rate limiter. The default `"api"` preset includes auth; pass `"auth"` for login/register routes that must run without a session.
3. **The controller is a pure function.** It takes typed input + the `Container`, does the work, and returns the envelope — no Elysia imports, no base class. This makes controllers trivial to unit-test and keeps `routes.ts` free of business logic.
4. **The route file is just wiring.** It maps HTTP verb + path to a controller function and declares request schemas / `can()` guards. In a real container, that is all `routes.ts` ever contains.

::: info What's next
The [Installation](./installation) guide sets up the project, the [Environment Setup](./environment) page explains every env var, and [Your First Container](./first-container) walks through scaffolding a full CRUD domain with `thalys:make:container`.
:::
