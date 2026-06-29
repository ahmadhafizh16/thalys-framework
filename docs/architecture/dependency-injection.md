# Dependency Injection

Thalys uses a minimal dependency injection container — about 60 lines of code, no decorators, no `reflect-metadata`, no runtime type introspection. It is explicitly designed to be Bun-safe, simple to reason about, and sufficient for the Porto architecture's needs.

## The Container class

The entire DI container lives in `src/Ship/Container/Container.ts`:

```ts
type Constructable<T> = new (...args: any[]) => T;

interface Injectable<T> {
	dependencies: readonly (Constructable<unknown> | string)[];
	factory: (...args: unknown[]) => T;
}

export class Container {
	private readonly instances = new Map<Constructable<unknown> | string, unknown>();
	private readonly factories = new Map<Constructable<unknown> | string, Injectable<unknown>>();

	/** Register a raw value (e.g. the `db` pool instance). */
	set<T>(token: string, value: T): void {
		this.instances.set(token, value);
	}

	/** Shorthand: auto-wire constructor. 90% of registrations. */
	bind<T>(
		token: Constructable<T>,
		...deps: (Constructable<unknown> | string)[]
	): void {
		this.factories.set(token, {
			dependencies: deps,
			factory: (...args: unknown[]) => new (token as new (...a: unknown[]) => T)(...args),
		});
	}

	/** Full control: custom factory for the 10% that need special wiring. */
	register<T>(
		token: Constructable<T> | string,
		dependencies: readonly (Constructable<unknown> | string)[],
		factory: (...args: unknown[]) => T,
	): void {
		this.factories.set(token, { dependencies, factory });
	}

	make<T>(token: Constructable<T> | string): T {
		const cached = this.instances.get(token);
		if (cached) return cached as T;

		const injectable = this.factories.get(token);
		if (!injectable) {
			throw new Error(
				`No binding registered for "${String(token)}". Did you forget to register it?`,
			);
		}

		const resolvedDeps = injectable.dependencies.map((dep) => {
			if (typeof dep === "string") {
				return this.instances.get(dep);
			}
			return this.make(dep); // class token → recursive resolve
		});

		const instance = injectable.factory(...resolvedDeps);
		this.instances.set(token, instance);
		return instance as T;
	}
}
```

Three registration methods, one resolution method. That's the entire API.

### `set()` — raw instances

`set()` registers a pre-built instance under a string token. Use it for objects that are constructed outside the container: the Drizzle `db` pool, a Redis client, a Bridge adapter instance, an external library.

```ts
container.set("db", db);
container.set("cache", new RedisCacheStore(process.env.REDIS_URL));
container.set("AuthBridgePort", container.make(InProcessAuthBridgeAdapter));
```

The value is stored in the `instances` map and returned as-is on every `make()` call.

### `bind()` — auto-wired classes

`bind()` is the workhorse — 90% of registrations use it. You pass a class constructor and a list of dependency tokens. The container stores a factory that calls `new Class(...resolvedDeps)`.

```ts
container.bind(HashPasswordTask);                              // no deps
container.bind(UserRepository, "db");                          // one string-token dep
container.bind(CreateUserAction, "db", UserRepository, HashPasswordTask);  // mixed deps
```

When `make(CreateUserAction)` is called, the container:

1. Looks up the factory for `CreateUserAction`.
2. Reads its dependencies: `["db", UserRepository, HashPasswordTask]`.
3. Resolves each dependency:
   - `"db"` is a string token → looks it up in `instances` → returns the Drizzle pool.
   - `UserRepository` is a class token → recursively calls `make(UserRepository)` → resolves its dep `"db"` → `new UserRepository(db)`.
   - `HashPasswordTask` is a class token → recursively calls `make(HashPasswordTask)` → no deps → `new HashPasswordTask()`.
4. Calls `new CreateUserAction(db, userRepo, hashPassword)`.
5. Caches the instance in `instances` → returns it.

::: tip How bind() works under the hood
`bind()` does **not** use `reflect-metadata` or runtime type introspection. It does not read the constructor's parameter types automatically. You must explicitly list the dependency tokens. This is intentional — explicit deps are auditable, work without polyfills, and are trivial to trace by reading `registerServices.ts`.
:::

### `register()` — custom factories

`register()` gives you full control with a custom factory function. Use it for the 10% of cases where `bind()` isn't enough — for example, when construction requires logic:

```ts
container.register("cache", [], () => {
	return process.env.REDIS_URL
		? new RedisCacheStore(process.env.REDIS_URL)
		: new InMemoryCacheStore();
});
```

In practice, Thalys's `registerServices.ts` uses `set()` with a ternary instead, which is equally clear:

```ts
const cache = process.env.REDIS_URL
	? new RedisCacheStore(process.env.REDIS_URL)
	: new InMemoryCacheStore();
container.set("cache", cache);
```

## String tokens vs class tokens

The container supports two token types, and they resolve differently:

| Token type | Registration | Resolution | Use case |
| --- | --- | --- | --- |
| **String token** | `container.set("db", db)` | Looks up `instances` map directly | Raw instances, Bridge ports, external libraries |
| **Class token** | `container.bind(UserRepository, "db")` | Recursively resolves deps, calls factory, caches | Auto-wired classes (Actions, Tasks, Repositories) |

```ts
// String token — raw instance
container.set("db", db);
const dbPool = container.make<AppDB>("db");

// Class token — auto-wired
container.bind(UserRepository, "db");
const repo = container.make(UserRepository);  // fully typed: UserRepository
```

::: warning Type safety trade-off
`container.make("db")` returns `unknown` — you must cast: `container.make<AppDB>("db")`. Class tokens are fully type-safe because TypeScript infers the return type from the constructor. Prefer class tokens for auto-wired classes; use string tokens only for raw instances and Bridge ports.
:::

## Singleton behavior

Both `set()` and `bind()` produce **singletons**. The first `make()` call constructs the instance and caches it in the `instances` map. Every subsequent `make()` call returns the cached instance.

```ts
container.bind(Singleton);
const a = container.make(Singleton);
const b = container.make(Singleton);
expect(a).toBe(b);  // true — same reference
```

This is intentional. Actions, Tasks, and Repositories are stateless — they hold only their injected dependencies, which are themselves singletons. Sharing instances is safe and avoids unnecessary allocations.

::: tip Need a fresh instance? Use withTransaction()
If you need a Repository scoped to a specific transaction, don't re-resolve from the container. Use `repository.withTransaction(tx)`:

```ts
return await this.db.transaction(async (tx) => {
	const txRepo = this.userRepo.withTransaction(tx);
	// txRepo is a new UserRepository instance backed by the transaction client
	return await txRepo.create(data);
});
```

`withTransaction()` creates a new repository instance with the transaction client, leaving the singleton untouched.
:::

## How Actions declare dependencies

Actions use **constructor injection** — they declare their dependencies as constructor parameters, and the container resolves them based on the `bind()` registration:

```ts
export class CreateUserAction extends BaseAction {
	constructor(
		db: AppDB,                                          // resolved from "db" token
		private readonly userRepo: UserRepository,           // resolved from UserRepository class token
		private readonly hashPassword: HashPasswordTask,    // resolved from HashPasswordTask class token
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

The binding that matches this constructor:

```ts
container.bind(CreateUserAction, "db", UserRepository, HashPasswordTask);
```

The order of `deps` in `bind()` **must** match the order of constructor parameters. The container does not match by parameter name — it passes resolved deps positionally.

::: warning Constructor parameter order matters
```ts
// Constructor: (db, userRepo, hashPassword)
// Binding:     ("db", UserRepository, HashPasswordTask)
//                 ↑        ↑               ↑
//                 db     userRepo       hashPassword
```
If you swap the order in `bind()`, the container will pass the wrong types and you'll get a runtime error. Always double-check that the binding order matches the constructor signature.
:::

## How Tasks accept AppClient

Tasks that interact with the database accept `AppClient` (= `AppDB | AppTx`) instead of `AppDB`. This allows the same Task to work with both the connection pool and an in-flight transaction:

```ts
// Ship/database/connection.ts
export type AppDB = typeof db;                                          // Drizzle pool client
export type AppTx = Parameters<Parameters<AppDB["transaction"]>[0]>[0]; // Transaction client
export type AppClient = AppDB | AppTx;                                  // Union — use this in Tasks
```

```ts
// A Task that accepts AppClient — works with both db and tx
export class SomeTask extends BaseTask {
	constructor(dbClient: AppClient) {
		super(dbClient);
	}

	async run(id: string) {
		return await this.dbClient.select().from(usersTable).where(eq(usersTable.id, id));
	}
}
```

Actions pass `tx` (the transaction client) to Tasks via `withTransaction()` on Repositories, or directly as a parameter. The Task doesn't know or care whether it's running inside a transaction — it just uses the client it was given.

```ts
export class CreateUserAction extends BaseAction {
	async execute(payload: CreateUserDTO): Promise<RawUserEntity> {
		return await this.db.transaction(async (tx) => {
			// txRepo uses tx (AppTx), not db (AppDB)
			const txRepo = this.userRepo.withTransaction(tx);
			return await txRepo.create(data);
		});
	}
}
```

::: tip Why AppClient instead of any?
Using `AppClient` instead of `any` gives you full type safety: the compiler verifies that the Task only calls methods that exist on both `AppDB` and `AppTx`. Biome's `noExplicitAny: error` rule enforces this — there is no `any` anywhere in the DI or Task layer.
:::

## Binding chains

Most non-trivial Actions have dependency chains several levels deep. Here's the full chain for `CreateUserAction`:

```ts
// registerServices.ts
container.set("db", db);                                    // tier 1: raw singleton
container.bind(UserRepository, "db");                        // tier 2: repo depends on db
container.bind(HashPasswordTask);                            // tier 2: task, no deps
container.bind(CreateUserAction, "db", UserRepository, HashPasswordTask);  // tier 3: action
```

The resolution tree when a controller function calls `container.make(CreateUserAction)`:

```txt
make(CreateUserAction)
├── "db"           → instances["db"] → Drizzle pool
├── UserRepository → make(UserRepository)
│   └── "db"       → instances["db"] → Drizzle pool (cached)
│   → new UserRepository(db)
└── HashPasswordTask → make(HashPasswordTask)
    └── (no deps)
    → new HashPasswordTask()
→ new CreateUserAction(db, userRepository, hashPasswordTask)
→ cache in instances[CreateUserAction]
```

Here's the same pattern for an Action that depends on a Bridge port:

```ts
// LoginAction depends on db + LoginTask
// LoginTask depends on "authInstance" (Better Auth)
container.set("authInstance", auth);
container.bind(LoginTask, "authInstance");
container.bind(LoginAction, "db", LoginTask);

// AuthBridge adapter depends on ValidateTokenAction + LogoutAction + GetUserPermissionsTask
container.bind(ValidateTokenTask, "authInstance");
container.bind(ValidateTokenAction, "db", ValidateTokenTask);
container.bind(LogoutTask, "authInstance");
container.bind(LogoutAction, "db", LogoutTask);
container.bind(GetUserPermissionsTask, "db");
container.bind(InProcessAuthBridgeAdapter, ValidateTokenAction, LogoutAction, GetUserPermissionsTask);
container.set("AuthBridgePort", container.make(InProcessAuthBridgeAdapter));
```

::: tip Bridge ports are resolved eagerly
Notice that Bridge adapters are resolved immediately with `container.make()` and then registered with `container.set()`:
```ts
container.set("AuthBridgePort", container.make(InProcessAuthBridgeAdapter));
```
This is because Bridge ports are resolved by **string token** (`"AuthBridgePort"`), and string tokens only look up the `instances` map — they don't trigger factory resolution. So we resolve the adapter once at registration time and store the instance.
:::

## Overriding services for testing

The container's `set()` method makes testing trivial. Because `set()` overwrites any existing entry in the `instances` map, you can swap any service for a mock before running tests:

```ts
import { container } from "@ship/setup";
import type { AuthBridgePort } from "@containers/AuthBridge/Adapters/InProcessAuthBridgeAdapter";

// Create a mock Bridge
const mockBridge: AuthBridgePort = {
	validateToken: async (token: string) => {
		if (token === "valid-token") {
			return {
				userId: "user-123",
				email: "test@example.com",
				name: "Test User",
				sessionId: "session-456",
				expiresAt: Date.now() + 3600_000,
				permissions: [{ resource: "user", action: "read" }],
			};
		}
		return null;
	},
	logout: async () => {},
};

// Override the real Bridge with the mock
container.set("AuthBridgePort", mockBridge);

// Now any controller function that calls container.make() will resolve the mock Bridge
const response = await app.handle(
	new Request("http://localhost/api/v1/users", {
		headers: { Authorization: "Bearer valid-token" },
	}),
);
```

You can override any string-token service the same way:

```ts
// Mock the database
container.set("db", mockDb);

// Mock the cache
container.set("cache", mockCache);

// Mock the rate limit store (always allow)
container.set("rateLimitStore", {
	check: async () => ({ allowed: true, limit: 100, remaining: 99, resetsAt: 0 }),
});

// Mock the error reporter (swallow errors in tests)
container.set("ErrorReporter", { capture: async () => {} });
```

::: tip Test helpers
Thalys ships with test helpers in `Ship/TestHelpers/`:
- `createTestApp()` — builds an Elysia app instance for integration tests
- `RequestTester` — fluently builds and sends requests with assertions
- `mockAuth()` — overrides `AuthBridgePort` with a configurable mock
- `withTestTransaction()` — wraps a test in a rollback transaction

See the [Testing guide](../guides/testing) for full examples.
:::

## Why no decorators or reflect-metadata

Many DI frameworks (NestJS, tsyringe, TypeDI) use `@Injectable()` decorators and `reflect-metadata` to auto-resolve constructor parameter types at runtime. Thalys deliberately avoids this approach for three reasons:

1. **Bun compatibility.** `reflect-metadata` is a polyfill that patches `Reflect`. While it works on Bun, it adds a global side effect that can interfere with other tooling. Thalys aims for zero global patches.

2. **Explicitness over magic.** With decorators, the dependency graph is implicit — you have to read every constructor to understand it. With `bind(Class, ...deps)`, the entire dependency graph is visible in one file (`registerServices.ts`). You can trace any Action's dependencies without opening the class.

3. **Simplicity.** The container is 60 lines. It has no runtime type introspection, no metadata emission, no decorator processing. It's a map of tokens to factories. This is easy to debug, easy to test, and easy to explain. The complexity budget saved here is spent on the [Bridge pattern](./bridge-pattern) and the [request pipeline](./request-pipeline), where it matters more.

::: warning The trade-off
The cost of explicit deps is that you must manually keep `bind()` call parameter order in sync with constructor parameter order. The container does not verify this at compile time. Mitigate this by:
- Always listing deps in the same order as constructor params.
- Running `bun run typecheck` after binding changes.
- Writing integration tests that exercise the full resolution chain.
:::

## Extension points

| You want to… | Do this |
| --- | --- |
| Register a new service | Add a `container.set()` or `container.bind()` line in `registerServices.ts` |
| Use a custom factory | Use `container.register(token, deps, factory)` instead of `bind()` |
| Override a service in tests | Call `container.set("token", mockInstance)` before the test |
| Add a new Bridge port | `container.bind(Adapter, ...deps)` then `container.set("PortName", container.make(Adapter))` |
| Inspect the dependency graph | Read `registerServices.ts` — it's the single source of truth for all bindings |

## Where to go next

- [Porto Layers](./porto-layers) — how Actions, Tasks, and Repositories use the injected dependencies
- [Bridge Pattern](./bridge-pattern) — how Bridge ports are wired and resolved
- [Ship vs Containers](./ship-vs-containers) — why `registerServices.ts` is the only Ship file that imports from Containers
