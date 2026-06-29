# Testing

Thalys provides a set of test helpers designed for the Bun test runner (`bun:test`). Tests run without a live HTTP server — they use Elysia's in-process `app.handle()` method. This guide covers unit testing Tasks/Actions with mocks, integration testing with a real database, test data factories, and the transaction-rollback pattern.

## Running tests

```bash
bun test                                    # full suite
bun test tests/UserTransformer.test.ts      # single file
bun test -t "maps raw entity"               # single test by name (-t matches describe/it text)
```

::: tip Tests run without a database
Most unit tests exercise pure transformers and mocked Tasks — they need no database connection. Integration tests that hit a real DB are tagged in their filename (`.realdb.test.ts`) and require the SSH tunnel to be up. Run just the DB-free tests with:

```bash
bun test --preload '' tests/Ship tests/Containers
```
:::

## The test helpers

All helpers are exported from `@ship/TestHelpers`:

```ts
import {
	RequestTester,
	createTestApp,
	createMockSession,
	createMockAuthBridge,
	withTestTransaction,
	RollbackSignal,
} from "@ship/TestHelpers";
```

### RequestTester

An in-process HTTP client. It constructs `Request` objects and feeds them to `app.handle()` — no port binding, no network I/O:

```ts
import { RequestTester } from "@ship/TestHelpers/RequestTester";

const tester = new RequestTester(app);

// GET with auth
const res = await tester.get("/api/v1/users", { token: "bearer-token-here" });
expect(res.status).toBe(200);
expect(res.body).toEqual({ data: [...], meta: {} });

// POST with body
const res = await tester.post("/api/v1/auth/register", {
	name: "Ada",
	email: "ada@test.com",
	password: "password123",
});

// PATCH
await tester.patch("/api/v1/users/123", { name: "New Name" }, { token });

// DELETE
await tester.delete("/api/v1/users/123", { token });
```

`RequestTester` automatically sets `Content-Type: application/json`, serialises the body, and adds the `Authorization: Bearer <token>` header when `token` is provided. The response is parsed as JSON (falling back to raw text if parsing fails).

### createTestApp

Assembles a minimal Elysia app for testing. It builds a real DI container, lets you override any binding (auth bridge, cache, queue), and mounts only the route plugins you specify:

```ts
import { createTestApp } from "@ship/TestHelpers/createTestApp";
import { createMockAuthBridge } from "@ship/TestHelpers/mockAuth";

const { app, container } = createTestApp({
	db,
	mockAuthBridge: createMockAuthBridge(),  // skip real auth
	cache: new InMemoryCacheStore(),         // fresh cache per test
	routes: [authRoutesV1, userRoutesV1],
});

const tester = new RequestTester(app);
```

Route plugins created via `routeGroup()` already include `shipContext` + `authContext` + rate limiting internally, so `createTestApp` only needs to decorate the `db` and `container` — no manual `.use(shipContext)` or `.use(authContext)` is required in test setup.

The `TestAppOptions` interface:

```ts
interface TestAppOptions {
	db: AppDB;
	mockAuthBridge?: unknown;
	cache?: CacheStore;
	queue?: QueueDriver;
	routes?: any[];
}
```

### mockAuth

Two helpers for bypassing the real auth flow in tests:

**`createMockSession(overrides?)`** — builds a `SessionDTO` without touching the database. The default session has wildcard permissions (`*/*`), so `can()` checks always pass:

```ts
import { createMockSession } from "@ship/TestHelpers/mockAuth";

const session = createMockSession({
	userId: "user-123",
	permissions: [{ resource: "user", action: "read" }],  // limited perms
});
```

**`createMockAuthBridge(session?)`** — returns an object implementing `AuthBridgePort` that always returns the given session for any token:

```ts
import { createMockAuthBridge } from "@ship/TestHelpers/mockAuth";

const bridge = createMockAuthBridge(createMockSession());
// bridge.validateToken("any-token") → returns the mock session
// bridge.logout("any-token") → no-op
```

Pass this to `createTestApp({ mockAuthBridge: bridge })` and every authenticated route will see the mock session without running Better Auth.

### withTestTransaction

Runs a callback inside a database transaction that is **always rolled back**. This lets tests insert and query data freely without polluting the database:

```ts
import { withTestTransaction } from "@ship/TestHelpers/withTestTransaction";

await withTestTransaction(db, async (tx) => {
	const repo = new UserRepository(tx);
	await repo.create({ name: "Test", email: "test@test.com" });
	const user = await repo.findByEmail("test@test.com");
	expect(user).not.toBeNull();
});
// DB is clean — the transaction was rolled back
```

## The RollbackSignal pattern

`withTestTransaction` works by throwing a sentinel error after the callback completes. The transaction's `catch` block sees the sentinel and treats it as success — any other error is re-thrown:

```ts
// src/Ship/TestHelpers/withTestTransaction.ts
export class RollbackSignal extends Error {
	constructor() {
		super("__ROLLBACK__");
		this.name = "RollbackSignal";
	}
}

export async function withTestTransaction(
	db: AppDB,
	callback: (tx: AppTx) => Promise<void>,
): Promise<void> {
	try {
		await db.transaction(async (tx) => {
			await callback(tx as AppTx);
			throw new RollbackSignal();  // always roll back
		});
	} catch (error) {
		if (error instanceof RollbackSignal) return;  // expected
		throw error;  // real error — re-throw
	}
}
```

::: tip Why not just rollback explicitly?
Postgres transactions auto-rollback when the callback throws. But if we called `tx.rollback()` explicitly, Drizzle's transaction wrapper would still throw. The sentinel pattern gives us a clean signal: "this rollback was intentional, don't fail the test." It also works with nested transactions (savepoints).
:::

## Unit testing Tasks

Tasks accept their dependencies via constructor injection, which makes them trivially mockable. Use `bun:test`'s `mock()` function:

```ts
import { describe, expect, it, mock } from "bun:test";
import { LoginTask } from "@containers/Auth/Tasks/LoginTask";

function createMockAuth(opts?: {
	signInResult?: { token: string; user: { id: string; email: string; name: string } } | null;
	sessionResult?: {
		user: { id: string; email: string; name: string };
		session: { id: string; expiresAt: Date };
	} | null;
}) {
	const signInEmail = mock(() => Promise.resolve(opts?.signInResult ?? null));
	const signUpEmail = mock(() => Promise.resolve(opts?.signUpResult ?? null));
	const getSession = mock(() => Promise.resolve(opts?.sessionResult ?? null));
	const revokeSession = mock(() => Promise.resolve(undefined));

	return {
		api: { signInEmail, signUpEmail, getSession, revokeSession },
	} as unknown as typeof import("@containers/Auth/betterAuth.config").auth;
}

describe("LoginTask", () => {
	it("returns a session with correct sessionId", async () => {
		const mockAuth = createMockAuth({
			signInResult: {
				token: "tok-123",
				user: { id: "user-1", email: "a@b.com", name: "Alice" },
			},
			sessionResult: {
				user: { id: "user-1", email: "a@b.com", name: "Alice" },
				session: { id: "sess-999", expiresAt: new Date("2026-07-01") },
			},
		});

		const task = new LoginTask(mockAuth);
		const result = await task.run({ email: "a@b.com", password: "password123" });

		expect(result.token).toBe("tok-123");
		expect(result.session.sessionId).toBe("sess-999");
	});

	it("throws INVALID_CREDENTIALS when signInEmail returns no token", async () => {
		const mockAuth = createMockAuth({ signInResult: null });
		const task = new LoginTask(mockAuth);

		expect(async () => {
			await task.run({ email: "x@y.com", password: "wrong" });
		}).toThrow();
	});
});
```

For Tasks that use the database (like `GetUserPermissionsTask`), mock the Drizzle query builder chain:

```ts
describe("GetUserPermissionsTask", () => {
	it("returns permissions for a user via JOIN", async () => {
		const mockDbClient = {
			select: mock(() => ({
				from: mock(() => ({
					innerJoin: mock(() => ({
						where: mock(() =>
							Promise.resolve([
								{ resource: "user", action: "read" },
								{ resource: "user", action: "create" },
							]),
						),
					})),
				})),
			})),
		};

		const task = new GetUserPermissionsTask(mockDbClient as never);
		const result = await task.run("user-1");

		expect(result).toHaveLength(2);
		expect(result[0]!.resource).toBe("user");
	});
});
```

## Unit testing Actions and the AuthBridge

Actions wrap Tasks and add the transactional boundary. Test them by mocking their Task dependencies:

```ts
describe("InProcessAuthBridgeAdapter", () => {
	it("returns a SessionDTO with permissions when token is valid", async () => {
		const validateTokenAction = {
			execute: mock(() => Promise.resolve({
				userId: "u1",
				email: "a@b.com",
				name: "Alice",
				sessionId: "sess-1",
				expiresAt: Date.now() + 3600_000,
			})),
		};
		const getUserPermissionsTask = {
			run: mock(() => Promise.resolve([
				{ resource: "user", action: "read" },
			])),
		};

		const adapter = new InProcessAuthBridgeAdapter(
			validateTokenAction as never,
			{ execute: mock() } as never,
			getUserPermissionsTask as never,
		);

		const result = await adapter.validateToken("valid-token");

		expect(result).not.toBeNull();
		expect(result!.permissions).toHaveLength(1);
		expect(result!.permissions[0]!.resource).toBe("user");
	});

	it("returns empty permissions when permission lookup throws", async () => {
		// ... adapter should gracefully fall back to []
	});
});
```

## Unit testing controller functions

Controller functions are plain `async function`s that take typed input + a `Container`. Because they have no Elysia dependency, you can test them directly with a mock `Container` — no HTTP layer, no `RequestTester`, no `createTestApp`:

```ts
import { describe, expect, it, mock } from "bun:test";
import { createUser } from "@containers/User/UI/API/Controllers/createUser";
import type { Container } from "@ship/Container/Container";

describe("createUser controller", () => {
	it("returns a wrapped response with the created user", async () => {
		const fakeUser = { id: "u-1", name: "Alice", email: "alice@test.com" };

		const mockContainer = {
			make: mock(() => ({
				execute: mock(() => Promise.resolve(fakeUser)),
			})),
		} as unknown as Container;

		const result = await createUser(
			{ name: "Alice", email: "alice@test.com", password: "password123" },
			mockContainer,
		);

		expect(result.data).toEqual({
			id: "u-1",
			name: "Alice",
			email: "alice@test.com",
		});
		expect(result.meta).toEqual({});
	});
});
```

This is the fastest way to test the controller → Action → Transformer wiring without spinning up an Elysia app. The mock `Container` only needs to satisfy the `container.make(ActionClass)` calls the controller makes.

## BaseFactory for test data

`BaseFactory` provides a Laravel-style factory pattern for generating fake data. Subclass it, define a `definition()` method, and use `make()` / `create()` / `seed()`:

```ts
import { BaseFactory } from "@ship/Factory/BaseFactory";

interface ProductInsert {
	name: string;
	sku: string;
	price: number;
}

class ProductFactory extends BaseFactory<ProductInsert> {
	definition(): ProductInsert {
		return {
			name: this.faker.commerce.productName(),
			sku: this.faker.string.alphanumeric(8).toUpperCase(),
			price: this.faker.number.int({ min: 100, max: 9999 }),
		};
	}
}
```

| Method | Returns | Persisted? | Description |
| --- | --- | --- | --- |
| `make(overrides?)` | `TInsert` | No | Generate one entity with fake data |
| `makeMany(count, overrides?)` | `TInsert[]` | No | Generate N entities |
| `create(repo, overrides?)` | `unknown` | Yes | Generate + persist via repository |
| `createMany(count, repo, overrides?)` | `unknown[]` | Yes | Generate + persist N entities |
| `seed(value)` | `this` | — | Set faker seed for deterministic output |

```ts
const factory = new ProductFactory();

// Just generate (no DB)
const data = factory.make({ price: 4999 });

// Generate + persist
const product = await factory.create(productRepo, { name: "Specific Name" });

// Deterministic output
factory.seed(42);
const a = factory.make();
factory.seed(42);
const b = factory.make();
expect(a).toEqual(b);
```

Generate a factory for a container:

```bash
bun run command thalys:make:factory Product
```

## Integration tests with a real database

Integration tests exercise the full stack — real DB, real auth, real routes. They require the SSH tunnel to be up (or direct DB access in CI).

The pattern: build a real Elysia app, mount the route groups (which already include `shipContext` + `authContext` + rate limiting via `routeGroup()`), wrap a `RequestTester` around it, and truncate tables between tests:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Elysia } from "elysia";
import { db } from "@ship/database/connection";
import { sql, eq } from "drizzle-orm";
import { RequestTester } from "@ship/TestHelpers/RequestTester";
import { container } from "@ship/setup";
import { authRoutesV1 } from "@containers/Auth/UI/API/v1/routes";
import { userRoutesV1 } from "@containers/User/UI/API/v1/routes";
import { InMemoryRateLimitStore } from "@ship/Http/InMemoryRateLimitStore";
import { rolesTable } from "@containers/Auth/Models/role.schema";
import { rolePermissionsTable } from "@containers/Auth/Models/permission.schema";
import { usersTable } from "@containers/User/Models/user.schema";

let testRoleId: string;
let tester: RequestTester;

function buildTestApp() {
	// Fresh rate limit store so tests don't hit the 5/min auth limit
	const freshStore = new InMemoryRateLimitStore();
	container.set<RateLimitStore>("rateLimitStore", freshStore);

	// Route groups created via routeGroup() already include shipContext,
	// authContext, and rate limiting — just mount them under /api.
	return new Elysia({ prefix: "/api" })
		.use(authRoutesV1)
		.use(userRoutesV1);
}

async function truncateAuthTables() {
	await db.execute(sql`TRUNCATE TABLE users CASCADE`);
	await db.execute(sql`TRUNCATE TABLE sessions CASCADE`);
	await db.execute(sql`TRUNCATE TABLE accounts CASCADE`);
	await db.execute(sql`TRUNCATE TABLE verifications CASCADE`);
}

async function seedAdminRole(): Promise<string> {
	const [role] = await db
		.insert(rolesTable)
		.values({ name: "admin", description: "Full administrative access." })
		.returning();

	await db.insert(rolePermissionsTable).values({
		roleId: role!.id,
		resource: "*",
		action: "*",
	});

	return role!.id;
}

async function assignRoleToUser(userId: string, roleId: string) {
	await db.update(usersTable).set({ roleId }).where(eq(usersTable.id, userId));
}

beforeAll(async () => {
	testRoleId = await seedAdminRole();
	tester = new RequestTester(buildTestApp());
});

afterAll(async () => {
	await truncateAuthTables();
});

beforeEach(async () => {
	await truncateAuthTables();
	container.set<RateLimitStore>("rateLimitStore", new InMemoryRateLimitStore());
});
```

## Real auth flow integration test

The canonical integration test exercises the full register → login → token → protected route → logout → revoked cycle:

```ts
describe("Integration (real DB): Auth flow", () => {
	it("register → use token → logout → token revoked", async () => {
		// 1. Register a new user
		const regRes = await tester.post("/api/v1/auth/register", {
			name: "Auth Flow User",
			email: "authflow@test.com",
			password: "password123",
		});

		expect(regRes.status).toBe(200);
		const token = (regRes.body as AuthResponse).data.token;
		const userId = (regRes.body as AuthResponse).data.session.userId;

		// 2. Try to access protected route — should get 403 (no role, no permissions)
		const deniedRes = await tester.get("/api/v1/users", { token });
		expect(deniedRes.status).toBe(403);

		// 3. Assign admin role directly in DB
		await assignRoleToUser(userId, testRoleId);

		// 4. Now the token should work (permissions loaded via JOIN)
		const allowedRes = await tester.get("/api/v1/users", { token });
		expect(allowedRes.status).toBe(200);

		// 5. Logout
		const logoutRes = await tester.post("/api/v1/auth/logout", undefined, { token });
		expect(logoutRes.status).toBe(200);

		// 6. Token should now be revoked — session no longer valid
		const revokedRes = await tester.get("/api/v1/users", { token });
		expect(revokedRes.status).toBe(403);
	});

	it("login with correct credentials returns valid token", async () => {
		await tester.post("/api/v1/auth/register", {
			name: "Login Test",
			email: "logintest@test.com",
			password: "password123",
		});

		const loginRes = await tester.post("/api/v1/auth/login", {
			email: "logintest@test.com",
			password: "password123",
		});

		expect(loginRes.status).toBe(200);
		expect((loginRes.body as AuthResponse).data.token).toBeTruthy();
	});

	it("login with wrong password returns 401", async () => {
		await tester.post("/api/v1/auth/register", {
			name: "Wrong Pass",
			email: "wrongpass@test.com",
			password: "password123",
		});

		const res = await tester.post("/api/v1/auth/login", {
			email: "wrongpass@test.com",
			password: "wrongpassword",
		});

		expect(res.status).toBe(401);
	});
});
```

::: tip Reset the rate limit store between tests
Auth routes use the `auth` preset (5/min). If you run multiple auth tests, the rate limiter will start returning `429`. Override `rateLimitStore` with a fresh `InMemoryRateLimitStore` in `beforeEach` to reset counters.
:::
