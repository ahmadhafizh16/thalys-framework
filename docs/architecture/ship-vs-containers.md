# Ship vs Containers

The Ship/Container split is the load-bearing wall of a Thalys codebase. Everything else — the Porto layers, the DI container, the Bridge pattern — exists to enforce or work around this one boundary. Get it right and a new engineer can navigate any domain in minutes. Get it wrong and the codebase becomes a tangle of cross-imports that no refactor can untangle.

## What Ship owns

`Ship` is the framework core. It contains every piece of infrastructure that is shared across all business domains:

| Concern | Location | What it provides |
| --- | --- | --- |
| Database connection | `Ship/database/connection.ts` | `db` (Drizzle client), `AppDB`, `AppTx`, `AppClient` types |
| Logger | `Ship/logger.ts` | Pino logger → MongoDB (`pino-mongodb`) + `pino-pretty` in dev |
| Error hierarchy | `Ship/Exceptions/AppError.ts` | `AppError`, `NotFoundError`, `ConflictError` |
| Elysia setup | `Ship/setup.ts` | `shipContext` — decorates routes with `db`/`log`/`container` + global `onError` |
| DI container | `Ship/Container/` | `Container` class + `registerServices()` (all bindings live here) |
| HTTP pipeline | `Ship/Http/` | `requestContext`, `authContext`, `rateLimitMiddleware`, `routeGroup`, `canMiddleware`, `profiler`, `requestLogger`, `healthCheck`, `swaggerPlugin` |
| Request base | `Ship/Http/BaseRequest.ts` | `BaseRequest` with `parseQuery()`, `validateId()`, allowlists |
| Response envelope | `Ship/Http/MainController.ts` | `wrapResponse()`, `wrapPaginated()` helpers (no longer a base class — controllers are plain functions) |
| Repository base | `Ship/Repository/BaseRepository.ts` | CRUD, cursor pagination, filter/sort, `withTransaction()` |
| Cache | `Ship/Cache/` | `CacheStore` port + `RedisCacheStore` / `InMemoryCacheStore` + `remember()` |
| Queue | `Ship/Queue/` | `QueueDriver` port + `RedisQueueDriver` / `InMemoryQueueDriver` + worker |
| Events | `Ship/Events/` | `BaseEvent` + `EventDispatcher` (in-process pub/sub) |
| Observability | `Ship/Observability/` | Prometheus metrics registry + `ErrorReporter` port |
| Console kernel | `Ship/Console/` | Artisan-style CLI kernel, `ConsoleContext`, `ConsoleCommand` contract |
| Generators | `Ship/Generators/` | `thalys:make:*` commands + stub templates |
| Localization | `Ship/Localization/` | `lz()` helper, locale files, `LocalizationService` |
| Auth middleware | `Ship/Http/authMiddleware.ts` | `extractToken()`, `authMiddleware()` |
| RBAC | `Ship/Http/canMiddleware.ts` | `can(resource, action)` permission guard |
| Factories | `Ship/Factory/BaseFactory.ts` | Base class for test data factories |
| Test helpers | `Ship/TestHelpers/` | `createTestApp`, `RequestTester`, `mockAuth`, `withTestTransaction` |

::: tip Infrastructure is interface-first
Every swappable concern in Ship (cache, queue, rate limiting, error reporting) sits behind a **port interface** registered in the DI container. The default implementations are production-ready, but replacing Redis with Memcached — or Better Auth with a remote auth microservice — is a one-binding change in `registerServices.ts`.
:::

## What Containers own

Each container owns its business behavior, organized into Porto layers:

| Layer | Location | Responsibility |
| --- | --- | --- |
| Models | `Models/*.schema.ts` | Drizzle `pgTable` schemas — the single source of truth for types |
| Models | `Models/*Repository.ts` | Repository classes extending `BaseRepository` |
| Requests | `Requests/` | TypeBox validation schemas (body) + `BaseRequest` subclasses (query criteria) |
| Actions | `Actions/` | Transactional orchestration — `db.transaction`, calls Tasks, maps through Transformer |
| Tasks | `Tasks/` | One DB/system operation each — `static async run(...)` |
| Transformers | `Transformers/` | Explicit client-facing response shape (no internal column leakage) |
| Routes | `UI/API/v1/routes.ts` | HTTP Elysia routes — thin wiring via `routeGroup()`, delegates to controller functions |
| Controllers | `UI/API/Controllers/*.ts` | One controller function per file — resolves Action, transforms, returns `wrapResponse(...)` |
| Commands | `UI/Command/` | Class-based console commands (seeders, maintenance scripts) |
| DTOs | `DTOs/` | Internal data transfer objects (e.g. `AuthSessionDTO`) |

A container never reaches into another container's `Tasks/`, `Models/`, `Transformers/`, or `Requests/`. Cross-domain communication goes through a [Bridge container](./bridge-pattern).

## The hard rule: Ship never imports from Containers

The dependency direction is strictly one-way:

```txt
Containers  ──imports──▶  Ship
Ship         ──never imports from──▶  Containers
```

This rule has one **deliberate exception**: `Ship/Container/registerServices.ts`. This file wires every container's Actions, Tasks, and Repositories into the DI container. It is the composition root — the single place where the framework knows about all domains. Without it, containers could not resolve their dependencies.

::: warning Why the exception is safe
`registerServices.ts` imports class **constructors** (types), not behavior. It never calls an Action or Task directly — it only binds them so the container can resolve them later. The actual execution always flows through the UI layer → Action → Task, never through Ship.
:::

```ts
// Ship/Container/registerServices.ts — the composition root
import { CreateUserAction } from "@containers/User/Actions/CreateUserAction";
import { UserRepository } from "@containers/User/Models/UserRepository";
import { HashPasswordTask } from "@containers/User/Tasks/HashPasswordTask";

export function createContainer(db: AppDB): Container {
	const container = new Container();
	container.set("db", db);

	// Repositories
	container.bind(UserRepository, "db");

	// Tasks
	container.bind(HashPasswordTask);

	// Actions
	container.bind(CreateUserAction, "db", UserRepository, HashPasswordTask);

	return container;
}
```

Every other file in `Ship/` that needs to touch a container's behavior does so through a **Bridge port** resolved from the container at runtime — never through a direct import of the container's internals.

## How containers register themselves

Container registration is centralized in `registerServices.ts`. The file has a `[GENERATOR_BINDINGS]#123;[GENERATOR_BINDINGS]#123;GENERATOR_BINDINGS[GENERATOR_BINDINGS]#125;[GENERATOR_BINDINGS]#125;` comment marker — when you run `thalys:make:container`, the generator appends the new container's bindings after this marker.

The registration follows a consistent pattern:

```ts
export function createContainer(db: AppDB): Container {
	const container = new Container();

	// 1. Raw singletons (string tokens)
	container.set("db", db);
	container.set("cache", process.env.REDIS_URL ? new RedisCacheStore(...) : new InMemoryCacheStore());
	container.set("queue", process.env.REDIS_URL ? new RedisQueueDriver(...) : new InMemoryQueueDriver());
	container.set("rateLimitStore", process.env.REDIS_URL ? new RedisRateLimitStore(...) : new InMemoryRateLimitStore());
	container.set("ErrorReporter", new ConsoleErrorReporter());
	container.set("eventDispatcher", new EventDispatcher());

	// 2. Tasks (class tokens, deps are string or class tokens)
	container.bind(HashPasswordTask);
	container.bind(LoginTask, "authInstance");
	container.bind(ValidateTokenTask, "authInstance");

	// 3. Actions (class tokens, deps chain to Tasks + Repositories)
	container.bind(CreateUserAction, "db", UserRepository, HashPasswordTask);
	container.bind(LoginAction, "db", LoginTask);

	// 4. Bridge ports (adapter instance registered under a string token)
	container.bind(InProcessAuthBridgeAdapter, ValidateTokenAction, LogoutAction, GetUserPermissionsTask);
	container.set("AuthBridgePort", container.make(InProcessAuthBridgeAdapter));

	// [GENERATOR_BINDINGS]#123;[GENERATOR_BINDINGS]#123;GENERATOR_BINDINGS[GENERATOR_BINDINGS]#125;[GENERATOR_BINDINGS]#125;
	return container;
}
```

::: tip The four registration tiers
1. **Raw singletons** — `container.set("token", instance)` for pre-built objects (db pool, cache, queue).
2. **Tasks** — `container.bind(Task, ...deps)` for auto-wired single-operation classes.
3. **Actions** — `container.bind(Action, "db", Task, Repository)` for transactional orchestrators.
4. **Bridge ports** — `container.bind(Adapter, ...)` then `container.set("Port", container.make(Adapter))` for cross-domain contracts.
:::

## The DI container pattern

Thalys uses a minimal DI container (~60 lines) with two primary registration methods:

- **`container.set(token, value)`** — registers a raw instance by string token. Use for pre-built singletons like the `db` pool, the cache store, or a Bridge adapter instance.
- **`container.bind(Class, ...deps)`** — auto-wires a class. The `deps` array lists constructor parameter tokens (either string tokens or class constructors). The container resolves each dep recursively and caches the result as a singleton.

### How a controller function resolves an Action

A controller function never instantiates an Action directly. It resolves it from the container, which recursively resolves all dependencies:

```ts
// src/Containers/User/UI/API/Controllers/createUser.ts
import { CreateUserAction } from "@containers/User/Actions/CreateUserAction";
import type { CreateUserDTO } from "@containers/User/Requests/user.request";
import { UserTransformer } from "@containers/User/Transformers/UserTransformer";
import type { Container } from "@ship/Container/Container";
import { wrapResponse } from "@ship/Http/MainController";

const transformer = new UserTransformer();

export async function createUser(body: CreateUserDTO, container: Container) {
	// container.make(CreateUserAction) resolves the full chain:
	//   CreateUserAction → "db" (pool) + UserRepository → "db" + HashPasswordTask
	const action = container.make(CreateUserAction);
	const created = await action.execute(body);
	return wrapResponse(transformer.transform(created));
}
```

The route file just wires the controller to an HTTP verb via `routeGroup()`:

```ts
// src/Containers/User/UI/API/v1/routes.ts
import { createUser } from "@containers/User/UI/API/Controllers/createUser";
import type { Container } from "@ship/Container/Container";
import { routeGroup } from "@ship/Http/routeGroup";
import { CreateUserRequest } from "@containers/User/Requests/user.request";

export const userRoutesV1 = routeGroup("/v1/users")
	.post("/", async ({ container, body, set }) => {
		set.status = 201;
		return createUser(body, container as Container);
	}, { body: CreateUserRequest });
```

The resolution chain works like this:

```txt
container.make(CreateUserAction)
  → reads CreateUserAction's deps: ["db", UserRepository, HashPasswordTask]
  → resolves "db"           → instances map → the Drizzle pool
  → resolves UserRepository → bind entry → deps: ["db"] → resolves "db" → new UserRepository(db)
  → resolves HashPasswordTask → bind entry → no deps → new HashPasswordTask()
  → new CreateUserAction(db, userRepo, hashPassword)
  → caches the instance → returns it
```

::: tip Singleton behavior
`bind()` returns the **same instance** every time `make()` is called. This is intentional — Actions, Tasks, and Repositories are stateless and safe to share. If you need a fresh instance (e.g. a repository scoped to a transaction), use `repository.withTransaction(tx)` instead of re-resolving from the container.
:::

### String tokens vs class tokens

The container supports two token types:

```ts
// String token — for raw instances and Bridge ports
container.set("db", db);
container.set("AuthBridgePort", container.make(InProcessAuthBridgeAdapter));
const db = container.make<AppDB>("db");
const bridge = container.make<AuthBridgePort>("AuthBridgePort");

// Class token — for auto-wired classes
container.bind(UserRepository, "db");
container.bind(CreateUserAction, "db", UserRepository, HashPasswordTask);
const repo = container.make(UserRepository);
const action = container.make(CreateUserAction);
```

String tokens are used when the registered value is not a class (a pool instance, an external library, a Bridge adapter). Class tokens are used when the container should auto-wire the constructor.

::: warning Type safety with string tokens
`container.make("db")` returns `unknown` — you must cast it: `container.make<AppDB>("db")`. Class tokens are fully type-safe because the container infers the return type from the constructor. Prefer class tokens wherever possible; use string tokens only for raw instances and Bridge ports.
:::

## When Ship reaches into container behavior

The only Ship files that interact with container logic do so through Bridge ports resolved at runtime:

```ts
// Ship/Http/authContext.ts — resolves AuthBridgePort per-request
export const authContext = new Elysia({ name: "auth-context" }).derive(
	{ as: "scoped" },
	async (ctx) => {
		const token = extractToken(ctx.request);
		if (!token) return { currentUser: undefined };

		const container = (ctx as unknown as { container: Container }).container;
		const authBridge = container.make<AuthBridgePort>("AuthBridgePort");
		const session = await authBridge.validateToken(token);
		return { currentUser: session ?? undefined };
	},
);
```

Ship never imports `LoginAction` or `ValidateTokenTask` — it imports the `AuthBridgePort` **interface type** from the Bridge container, and resolves the concrete adapter from the container at runtime. This is what allows the auth implementation to be swapped without touching Ship.

## Extension points

| You want to… | Do this |
| --- | --- |
| Add a new infrastructure service | Create a port interface + implementation in `Ship/`, bind it in `registerServices.ts` |
| Register a new container's services | Add bindings in `registerServices.ts` (or let `make:container` do it via `[GENERATOR_BINDINGS]#123;[GENERATOR_BINDINGS]#123;GENERATOR_BINDINGS[GENERATOR_BINDINGS]#125;[GENERATOR_BINDINGS]#125;`) |
| Override a service for testing | Call `container.set("token", mockInstance)` before tests — see [Dependency Injection](./dependency-injection#overriding-services-for-testing) |
| Add a new Ship middleware | Create an Elysia plugin in `Ship/Http/`, wire it into `routeGroup()` or `shipContext` |

## Where to go next

- [Bridge Pattern](./bridge-pattern) — how Ship middleware uses Bridge ports without importing container internals
- [Dependency Injection](./dependency-injection) — the full DI container deep dive
- [Porto Layers](./porto-layers) — what each layer inside a container does
