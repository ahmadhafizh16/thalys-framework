# Architecture Overview

Thalys organizes every application into two top-level layers under `src/`: **Ship** (shared infrastructure) and **Containers** (isolated business domains). This split is the single most important structural decision in the framework — it determines what may import what, where business logic lives, and how cross-domain communication happens.

## The two layers

```txt
src/
├── index.ts              # Elysia entrypoint — mounts route groups, health, metrics, swagger
├── command.ts            # Console entrypoint — boots the CLI kernel without the HTTP server
├── Ship/                 # Shared infrastructure (the framework core)
│   ├── setup.ts          # shipContext: decorates routes with db/log/container + global error handler
│   ├── database/         # Drizzle connection, AppDB / AppTx / AppClient types
│   ├── Container/        # DI container + registerServices()
│   ├── Http/             # Request pipeline: routeGroup, auth, RBAC, rate limiting, profiling, logging
│   ├── Cache/            # CacheStore port + Redis / InMemory implementations
│   ├── Queue/            # QueueDriver port + Redis / InMemory implementations + worker
│   ├── Events/           # BaseEvent + EventDispatcher (in-process pub/sub)
│   ├── Exceptions/       # AppError hierarchy (NotFoundError, ConflictError, ...)
│   ├── Observability/    # Prometheus metrics registry + ErrorReporter port
│   ├── Repository/       # BaseRepository<T> — cursor pagination, CRUD, filter/sort
│   ├── Generators/       # thalys:make:* commands + stub templates
│   ├── Console/          # Artisan-style CLI kernel, context, command contract
│   └── logger.ts         # Pino logger (MongoDB + pino-pretty)
└── Containers/           # Isolated business domains
    ├── Auth/             # Authentication (Better Auth) — producer
    ├── AuthBridge/       # Bridge: AuthBridgePort for Ship middleware
    ├── RolesBridge/      # Bridge: RolesBridgePort for role lookups
    └── User/             # User domain — full CRUD example
```

### Ship — the opinionated core

`Ship` owns everything that is not business behavior: database connections, the logger, the `AppError` hierarchy, the `shipContext` Elysia instance that decorates routes with `db` / `log` / `container`, the Artisan-style console kernel, code generators, middleware, cache, queue, events, and observability.

Ship is the **only** layer that any container may import from. It never imports from `Containers` — the dependency direction is strictly one-way.

### Containers — isolated business domains

Each container is a self-contained business domain (`User`, `Auth`, `Product`, `Order`, …). Internally, every container follows the same **Porto-inspired layering**:

```txt
Containers/Product/
├── Models/
│   ├── product.schema.ts    # Drizzle pgTable — the single source of truth for types
│   └── ProductRepository.ts # extends BaseRepository<typeof productsTable>
├── Requests/                # TypeBox validation schemas (create, update, list query)
├── Actions/                 # Transactional orchestration (Create, Update, Delete)
├── Tasks/                   # One DB/system operation each
├── Transformers/            # Client-facing response shaping (no internal columns leak)
└── UI/
    ├── API/
    │   ├── v1/routes.ts     # Thin wiring via routeGroup(), delegates to Controllers
    │   └── Controllers/     # One controller function per file
    └── Command/             # Class-based console commands (seeders, etc.)
```

A container exposes two UI adapters: **HTTP** under `UI/API/` and **CLI** under `UI/Command/`. Neither adapter performs database writes directly — they delegate to Actions.

## The data flow

Every request — whether HTTP or console — flows through the same one-directional pipeline:

```txt
HTTP request
  → UI/API/routes.ts       (routeGroup: shipContext + authContext + rate limit; binds request schema)
    → Requests/             (TypeBox validation — the input type)
      → UI/API/Controllers/ (controller function: resolves Action from container, calls it)
        → Actions/            (opens db.transaction, orchestrates Tasks)
          → Tasks/            (one DB operation each, accepts AppClient = db | tx)
          → Models/           (Drizzle schema + repository)
        → Transformers/       (maps Raw<Entity> → Safe<Entity>Output)
    → wrapResponse()          (envelopes result as { data, meta })
```

No layer may skip ahead. A route never touches a Task. A Task never calls another Task. A Transformer never touches the database. This is what makes a Thalys codebase navigable: to understand any endpoint, you read exactly one file per layer.

```mermaid
flowchart TD
    REQ[HTTP Request] --> RC[requestContext\nrequestId + startTime]
    RC --> PROF1[profilerPlugin\ndev: reset counters]
    PROF1 --> RG[routeGroup\nshipContext db/log/container\n+ authContext currentUser\n+ rateLimitMiddleware]
    RG --> ROUTE[UI/API/routes.ts\nthin wiring]
    ROUTE --> REQV[Requests/\nTypeBox validation]
    REQV --> CAN[can beforeHandle\npermission guard]
    CAN --> CTRL[UI/API/Controllers/\ncontroller function]
    CTRL --> ACTION[Actions/.execute]
    ACTION --> TX[db.transaction]
    TX --> TASK[Tasks/.run\none DB operation]
    TASK --> MODEL[Models/\nRepository + schema]
    ACTION --> TRANS[Transformers/\nRaw → Safe output]
    TRANS --> WRAP[wrapResponse\n{ data, meta }]
    WRAP --> PROF2[profilerPlugin\n_profile in dev]
    PROF2 --> LOG[requestLogger\nPino entry]
    LOG --> RESP[HTTP Response]
```

## Core rules

### Actions are the transactional boundary

An Action is a class with a `static async execute(...)` method. It opens `db.transaction(...)`, orchestrates one or more Tasks inside that transaction, and maps the result through a Transformer. Actions receive their DB client via parameter injection — they never import the singleton `db`.

```ts
export class CreateUserAction extends BaseAction {
	constructor(
		db: AppDB,
		private readonly userRepo: UserRepository,
		private readonly hashPassword: HashPasswordTask,
	) {
		super(db);
	}

	async execute(payload: CreateUserDTO): Promise<RawUserEntity> {
		const hashedPassword = await this.hashPassword.run(payload.password);

		return await this.db.transaction(async (tx) => {
			const txRepo = this.userRepo.withTransaction(tx);
			await txRepo.assertEmailAvailable(payload.email);
			return await txRepo.create({ ...payload, password: hashedPassword });
		});
	}
}
```

::: tip Actions CAN call other Actions
A sub-Action is valid — for example, a `PlaceOrderAction` might call an internal `ReserveStockAction`. The rule is that each Action still manages its own transaction. What is forbidden is a **Task** calling another Task.
:::

### Tasks do exactly one DB operation

A Task is a class with a `static async run(...)` method. It performs a single database or system operation — one insert, one select, one external API call. Tasks accept `AppClient` (= `AppDB | AppTx`) so they work with both the connection pool and an in-flight transaction.

```ts
export class HashPasswordTask {
	async run(password: string): Promise<string> {
		return await Bun.password.hash(password, { algorithm: "bcrypt", cost: 12 });
	}
}
```

::: warning Tasks never call other Tasks
A Task that calls another Task creates a hidden coupling that defeats the one-operation-per-file contract. If two operations must happen together, put them in an Action. If the same operation is reused, extract it into its own Task and let each Action call it independently.
:::

### Cross-container communication goes through Bridges

A container that needs another container's behavior imports from a **Bridge container**, never from the producer's internals. A Bridge holds DTOs (flat, serializable data shapes) and an Adapter that calls the producer container's **Actions**.

```txt
Containers/
  Auth/                  # producer — owns auth logic
  AuthBridge/            # bridge — exposes AuthBridgePort interface
    DTOs/
      AuthBridgeDTO.ts   # SessionDTO (the data shape consumers need)
    Adapters/
      InProcessAuthBridgeAdapter.ts  # calls Auth's Actions
```

::: tip Why Bridges?
Bridges create a hard architectural boundary. A future `HttpAuthBridgeAdapter` (calling a remote auth microservice) replaces `InProcessAuthBridgeAdapter` with **zero changes** to any consumer. See [Bridge Pattern](./bridge-pattern) for the full deep dive.
:::

## Extension points

| You want to… | Do this |
| --- | --- |
| Add a new business domain | `bun run command make:container Product` — scaffolds the full Porto layout |
| Add a new HTTP endpoint | Add a controller function in `UI/API/Controllers/`, wire it in `UI/API/v1/routes.ts` via `routeGroup()` |
| Add a new console command | Add a class in `UI/Command/`, register it in `Ship/Console/commands.ts` |
| Communicate across domains | Create a Bridge container with a Port interface + Adapter |
| Swap an infrastructure impl | Change the binding in `registerServices.ts` (e.g. Redis → in-memory cache) |
| Add a new error type | Extend `AppError` in `Ship/Exceptions/` — the global handler catches it automatically |
| Override a service for testing | `container.set("AuthBridgePort", mockBridge)` before the test runs |

## Where to go next

- [Ship vs Containers](./ship-vs-containers) — the hard separation rule and how containers register themselves
- [Bridge Pattern](./bridge-pattern) — how cross-domain communication works without breaking isolation
- [Dependency Injection](./dependency-injection) — the ~60-line DI container and how binding chains work
- [Porto Layers](./porto-layers) — the Action → Task → Transformer flow in detail
- [Request Pipeline](./request-pipeline) — the full request lifecycle from middleware to response envelope
