# Your First Container

This tutorial walks you through scaffolding a complete CRUD domain — a `Product` container — from a single command, then explains every generated file, runs the migration, and tests the endpoints with curl. By the end you will understand the full Porto request flow and how Thalys auto-registers new containers without manual wiring.

## What you will build

A `Product` container exposing five REST endpoints under `/api/v1/products`:

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/` | open | Create a product |
| `GET` | `/` | `product:read` | List products (paginated) |
| `GET` | `/:id` | `product:read` | Get one product |
| `PATCH` | `/:id` | `product:update` | Update a product |
| `DELETE` | `/:id` | `product:delete` | Delete a product |

All five are generated for you. You will not write a single line of code in this tutorial — you will run one command, run a migration, and curl the results.

## Step 1 — Scaffold the container

Thalys ships an Artisan-style console. The `thalys:make:container` command scaffolds a full Porto container. Pass `--crud` to generate the complete CRUD stack (model, repository, actions, transformer, requests, and routes) instead of a bare skeleton:

```bash
bun run command thalys:make:container Product --crud
```

You will see output like:

```bash
Scaffolded Product container with full CRUD  container=src/Containers/Product  files=14  crud=true  registered=true
```

The command created **14 files** and updated **2 existing files** (auto-registration). Here is exactly what was generated:

```txt
src/Containers/Product/
├── Models/
│   ├── product.schema.ts          # Drizzle pgTable + Raw/Insert types
│   └── ProductRepository.ts       # extends BaseRepository<typeof productsTable>
├── Requests/
│   ├── product.request.ts         # CreateProductRequest + UpdateProductRequest (TypeBox)
│   └── list-products.request.ts   # ListProductsRequest (filter/sort/pagination allowlist)
├── Actions/
│   ├── CreateProductAction.ts     # transactional create
│   ├── UpdateProductAction.ts     # transactional update (checks existence)
│   └── DeleteProductAction.ts     # transactional delete (checks existence)
├── Transformers/
│   └── ProductTransformer.ts      # RawProductEntity → SafeProductOutput
└── UI/API/
    ├── Controllers/               # one plain async function per endpoint
    │   ├── createProduct.ts       # createProduct(body, container) → wrapResponse
    │   ├── listProducts.ts        # listProducts(query, container) → wrapPaginated
    │   ├── getProduct.ts          # getUser(params, container) → wrapResponse
    │   ├── updateProduct.ts       # updateProduct(params, body, container) → wrapResponse
    │   └── deleteProduct.ts       # deleteProduct(params, container) → wrapResponse
    └── v1/
        └── routes.ts              # thin wiring: routeGroup() + controller delegation
```

Plus two auto-registration edits:

- `src/Ship/Container/registerServices.ts` — imports + DI bindings added.
- `src/index.ts` — route import + `.use(productRoutesV1)` mount added.

Let's walk through each generated file.

## Step 2 — The schema file and the UUIDv7 PK pattern

Every container starts with its Drizzle schema — the single source of truth for types. Here is the generated `product.schema.ts`:

```ts
// src/Containers/Product/Models/product.schema.ts
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

export const productsTable = pgTable("products", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => uuidv7()),
	name: text("name").notNull(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type RawProductEntity = typeof productsTable.$inferSelect;
export type InsertProductEntity = typeof productsTable.$inferInsert;
```

::: tip Why UUIDv7?
Thalys uses **UUIDv7** as the primary key pattern for every generated schema. UUIDv7 is time-ordered (unlike UUIDv4), so B-tree index inserts are sequential rather than random — this avoids index fragmentation at scale. It is also globally unique, which means you can generate IDs client-side or merge data across databases without collisions.

The PK is `text` (not `uuid`) because the `uuidv7` npm package returns a string, and Postgres stores it efficiently as text. The `$defaultFn(() => uuidv7())` hook means Drizzle generates the ID in JavaScript at insert time — you never need to pass it explicitly.
:::

Two types are exported from the schema, and they propagate through the entire container:

- `RawProductEntity` — the **row shape** (what `SELECT *` returns). Used by repositories, tasks, and as the transformer's input type.
- `InsertProductEntity` — the **insert shape** (which fields are required vs optional on write). Used by `BaseRepository.create()`.

These two types are the foundation of Thalys's end-to-end type safety. The repository is generic over them, the actions return `RawProductEntity`, and the transformer maps `RawProductEntity` to the safe output. No `as any` appears anywhere in the chain.

### Customizing the schema

The stub generates a minimal `name` column. Real domains need more — just add columns to the `pgTable` and run `db:generate` (Step 6). For example:

```ts
export const productsTable = pgTable("products", {
	id: text("id").primaryKey().$defaultFn(() => uuidv7()),
	name: text("name").notNull(),
	sku: text("sku").notNull().unique(),
	priceCents: integer("price_cents").notNull(),
	inStock: boolean("in_stock").notNull().default(true),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

The `RawProductEntity` and `InsertProductEntity` types update automatically — Drizzle infers them from the `pgTable` definition. Every downstream file (repository, actions, transformer) picks up the new columns through the type system.

## Step 3 — The repository and BaseRepository

The generated repository extends `BaseRepository<T>`, which provides cursor-based pagination, filtering, sorting, and CRUD out of the box:

```ts
// src/Containers/Product/Models/ProductRepository.ts
import type { AppClient } from "@ship/database/connection";
import { BaseRepository } from "@ship/Repository/BaseRepository";
import { productsTable } from "@containers/Product/Models/product.schema";

export class ProductRepository extends BaseRepository<typeof productsTable> {
	constructor(db: AppClient) {
		super(db, productsTable);
	}
}
```

That's the entire file — and it already gives you `findById`, `findOne`, `findMany`, `create`, `update`, `delete`, and `paginate`. The magic is in `BaseRepository`.

### How `BaseRepository` works under the hood

`BaseRepository<T extends PgTable>` is generic over the Drizzle table type. The constructor takes an `AppClient` (which is `AppDB | AppTx` — the pooled connection **or** a transaction) and the table instance:

```ts
// src/Ship/Repository/BaseRepository.ts (excerpt)
export abstract class BaseRepository<T extends PgTable> {
	constructor(
		protected readonly db: AppClient,
		protected readonly table: T,
	) {}

	async findById(id: string | number): Promise<T["$inferSelect"] | null> {
		const rows = await this.db.select().from(this.table).where(eq(this.pk(), id)).limit(1);
		return rows[0] ?? null;
	}

	async create(data: T["$inferInsert"]): Promise<T["$inferSelect"]> {
		const inserted = await this.db.insert(this.table).values(data).returning();
		const row = inserted[0];
		if (!row) throw new Error("Insert returned no row.");
		return row;
	}

	async paginate(criteria: QueryCriteria): Promise<PaginatedResult<T["$inferSelect"]>> {
		const limit = Math.min(criteria.page?.limit ?? 20, 100);
		// ... cursor pagination with count + sort + filter
		return { data, meta: { total, cursor, hasMore } };
	}

	/** Create a new repository instance scoped to a transaction. */
	withTransaction(tx: AppClient): this {
		return new (this.constructor as any)(tx, this.table);
	}
}
```

The key design decisions:

1. **`AppClient` not `AppDB`.** The repository accepts the union type `AppDB | AppTx`, so the **same** repository class works with both the connection pool and an in-flight transaction. Actions call `withTransaction(tx)` to get a transaction-scoped copy.
2. **`withTransaction()` returns `this`.** It constructs a new instance of the same concrete class bound to `tx`. This is why `UserRepository` can add domain methods like `assertEmailAvailable()` and still get transaction support for free.
3. **Cursor pagination, not offset.** `paginate()` uses `gt(pk, cursor)` for pagination, which is stable under concurrent inserts. The `PaginatedResult` returns `{ data, meta: { total, cursor, hasMore } }`.

### Adding domain-specific queries

To add a query that `BaseRepository` does not provide, just add a method to the concrete repository. The existing `UserRepository` is the canonical example:

```ts
// src/Containers/User/Models/UserRepository.ts
export class UserRepository extends BaseRepository<typeof usersTable> {
	constructor(db: AppClient) {
		super(db, usersTable);
	}

	async assertEmailAvailable(email: string): Promise<void> {
		const existing = await this.findOne(eq(usersTable.email, email));
		if (existing) {
			throw new ConflictError(`The email '${email}' is already allocated.`);
		}
	}
}
```

## Step 4 — The actions and the transaction boundary

Actions are the **transactional orchestration layer**. Each generated action opens a `db.transaction(...)`, runs tasks inside it, and returns the domain result. Here are the three generated actions:

### CreateProductAction

```ts
// src/Containers/Product/Actions/CreateProductAction.ts
import type { AppDB } from "@ship/database/connection";
import { BaseAction } from "@ship/Actions/BaseAction";
import type { ProductRepository } from "@containers/Product/Models/ProductRepository";
import type { RawProductEntity } from "@containers/Product/Models/product.schema";
import type { CreateProductDTO } from "@containers/Product/Requests/product.request";

export class CreateProductAction extends BaseAction {
	constructor(
		db: AppDB,
		private readonly productRepo: ProductRepository,
	) {
		super(db);
	}

	async execute(payload: CreateProductDTO): Promise<RawProductEntity> {
		return await this.db.transaction(async (tx) => {
			const txRepo = this.productRepo.withTransaction(tx);
			return await txRepo.create({
				name: payload.name,
			});
		});
	}
}
```

### UpdateProductAction

```ts
// src/Containers/Product/Actions/UpdateProductAction.ts (excerpt)
export class UpdateProductAction extends BaseAction {
	constructor(
		db: AppDB,
		private readonly productRepo: ProductRepository,
	) {
		super(db);
	}

	async execute(input: UpdateProductInput): Promise<RawProductEntity> {
		return await this.db.transaction(async (tx) => {
			const txRepo = this.productRepo.withTransaction(tx);
			const existing = await txRepo.findById(input.id);
			if (!existing) throw new NotFoundError("Product");

			const updates: Partial<typeof productsTable.$inferInsert> = {};
			if (input.name !== undefined) updates.name = input.name;

			const updated = await txRepo.update(eq(productsTable.id, input.id), updates);
			if (!updated) throw new NotFoundError("Product");
			return updated;
		});
	}
}
```

### DeleteProductAction

```ts
// src/Containers/Product/Actions/DeleteProductAction.ts
export class DeleteProductAction extends BaseAction {
	constructor(
		db: AppDB,
		private readonly productRepo: ProductRepository,
	) {
		super(db);
	}

	async execute(id: string): Promise<void> {
		await this.db.transaction(async (tx) => {
			const txRepo = this.productRepo.withTransaction(tx);
			const existing = await txRepo.findById(id);
			if (!existing) throw new NotFoundError("Product");
			await txRepo.delete(eq(productsTable.id, id));
		});
	}
}
```

### Why the transaction boundary lives in Actions

There are three rules that define what an Action is in Thalys:

1. **Actions are the only layer that opens transactions.** Routes, tasks, and transformers never call `db.transaction(...)`. This makes it trivial to see, by grepping for `.transaction(`, exactly where transactional boundaries exist.
2. **Actions receive dependencies by constructor injection.** The `db` (an `AppDB`, the pool) and the repository are injected by the DI container — the action never imports the `db` singleton. This makes actions testable: pass a mock `AppDB` and a fake repository.
3. **Actions call `withTransaction(tx)` on repositories.** The repository is constructed against the pool, but inside the transaction it is re-scoped to `tx` via `withTransaction()`. Every query the repository runs inside the transaction block is part of that transaction — if anything throws, the whole thing rolls back.

Notice that `UpdateProductAction` and `DeleteProductAction` both perform an existence check **inside** the transaction before mutating. This is deliberate: it avoids a TOCTOU race where a row is deleted between the check and the write. If the row does not exist, `NotFoundError("Product")` throws and the transaction rolls back cleanly.

::: tip Actions never call other Actions directly
A Task performs exactly one DB operation and never calls another Task or an Action. If an Action needs behavior from another domain, it goes through a **Bridge container** (see [Architecture: Bridge Pattern](/architecture/bridge-pattern)), not a direct import.
:::

## Step 5 — Controllers, routes, and the request pipeline

The generated UI layer is split into two concerns:

1. **Controller functions** in `UI/API/Controllers/` — one plain `async function` per endpoint. Each takes typed input + the `Container`, resolves an Action (or repository for reads), runs the transformer, and returns `wrapResponse(...)`. There is no class, no base class, no Elysia import — controllers are pure, framework-agnostic functions that are trivial to unit-test.
2. **`routes.ts`** — thin wiring. It calls `routeGroup()` to assemble the middleware stack, then delegates each route body to a controller function.

### The `routeGroup()` helper

Before the refactor, every route file repeated `.use(shipContext).use(authContext).onBeforeHandle(rateLimitMiddleware(...))`. That block now lives in a single helper:

```ts
// src/Ship/Http/routeGroup.ts
export function routeGroup(prefix: string, preset: RoutePreset = "api") {
	const store = container.make<RateLimitStore>("rateLimitStore");
	const instance = new Elysia({ prefix }).use(shipContext);

	if (preset !== "auth") {
		instance.use(authContext);
	}

	return instance.onBeforeHandle(async (ctx) => {
		await rateLimitMiddleware(store, RATE_LIMIT_PRESETS[preset])(ctx);
	});
}
```

Call it with the default `"api"` preset for any route group that requires a logged-in user, or pass `"auth"` for login/register/logout routes that must run **without** an existing session:

```ts
routeGroup("/v1/products")          // → shipContext + authContext + "api" rate limit
routeGroup("/v1/auth", "auth")      // → shipContext + "auth" rate limit (no authContext)
```

### A controller function

Each controller is one file, one exported function. The transformer is instantiated once at module scope (stateless, reusable). Here is the create controller:

```ts
// src/Containers/Product/UI/API/Controllers/createProduct.ts
import { CreateProductAction } from "@containers/Product/Actions/CreateProductAction";
import type { CreateProductDTO } from "@containers/Product/Requests/product.request";
import { ProductTransformer } from "@containers/Product/Transformers/ProductTransformer";
import type { Container } from "@ship/Container/Container";
import { wrapResponse } from "@ship/Http/MainController";

const transformer = new ProductTransformer();

export async function createProduct(body: CreateProductDTO, container: Container) {
	const action = container.make(CreateProductAction);
	const created = await action.execute(body);
	return wrapResponse(transformer.transform(created));
}
```

The read controllers resolve the repository directly (reads do not need a transaction, so they skip the Action layer). The detail controller also performs the existence check and ID validation:

```ts
// src/Containers/Product/UI/API/Controllers/getProduct.ts
import { ProductRepository } from "@containers/Product/Models/ProductRepository";
import { ProductTransformer } from "@containers/Product/Transformers/ProductTransformer";
import type { Container } from "@ship/Container/Container";
import { NotFoundError } from "@ship/Exceptions/AppError";
import { BaseRequest } from "@ship/Http/BaseRequest";
import { wrapResponse } from "@ship/Http/MainController";

const transformer = new ProductTransformer();

export async function getProduct(params: { id: string }, container: Container) {
	const id = BaseRequest.validateId(params.id);
	const repo = container.make(ProductRepository);
	const entity = await repo.findById(id);
	if (!entity) throw new NotFoundError("Product");
	return wrapResponse(transformer.transform(entity));
}
```

The list controller parses the query through `ListProductsRequest` and returns `wrapPaginated`:

```ts
// src/Containers/Product/UI/API/Controllers/listProducts.ts
import { ProductRepository } from "@containers/Product/Models/ProductRepository";
import { ListProductsRequest } from "@containers/Product/Requests/list-products.request";
import { ProductTransformer } from "@containers/Product/Transformers/ProductTransformer";
import type { Container } from "@ship/Container/Container";
import { wrapPaginated } from "@ship/Http/MainController";

const transformer = new ProductTransformer();

export async function listProducts(
	query: Record<string, string | undefined>,
	container: Container,
) {
	const criteria = ListProductsRequest.parse(query);
	const repo = container.make(ProductRepository);
	const result = await repo.paginate(criteria);
	return wrapPaginated(
		result.data.map((e) => transformer.transform(e)),
		result.meta,
	);
}
```

The update and delete controllers follow the same shape — validate the ID, resolve the Action, execute, and envelope the result. See `updateProduct.ts` and `deleteProduct.ts` in `UI/API/Controllers/`.

### The route file — thin wiring

With the logic in controllers, `routes.ts` is now just declaration: which HTTP verb + path maps to which controller, what request schema validates the body, and which `can()` permission guards the route. No Action imports, no transformer instantiation, no `wrapResponse` call appears here.

```ts
// src/Containers/Product/UI/API/v1/routes.ts
import { createProduct } from "@containers/Product/UI/API/Controllers/createProduct";
import { deleteProduct } from "@containers/Product/UI/API/Controllers/deleteProduct";
import { getProduct } from "@containers/Product/UI/API/Controllers/getProduct";
import { listProducts } from "@containers/Product/UI/API/Controllers/listProducts";
import { updateProduct } from "@containers/Product/UI/API/Controllers/updateProduct";
import { UpdateProductRequest } from "@containers/Product/Requests/product.request";
import { CreateProductRequest } from "@containers/Product/Requests/product.request";
import type { Container } from "@ship/Container/Container";
import { can } from "@ship/Http/canMiddleware";
import { routeGroup } from "@ship/Http/routeGroup";

export const productRoutesV1 = routeGroup("/v1/products")
	// Create — open
	.post(
		"/",
		async ({ container, body, set }) => {
			set.status = 201;
			return createProduct(body, container as Container);
		},
		{ body: CreateProductRequest },
	)
	// List — auth + read permission
	.get(
		"/",
		async ({ container, query }) => listProducts(query, container as Container),
		{ beforeHandle: [can("product", "read")] },
	)
	// Detail — auth + read permission
	.get(
		"/:id",
		async ({ container, params }) => getProduct(params, container as Container),
		{ beforeHandle: [can("product", "read")] },
	)
	// Update — auth + update permission
	.patch(
		"/:id",
		async ({ container, params, body }) =>
			updateProduct(params, body, container as Container),
		{ body: UpdateProductRequest, beforeHandle: [can("product", "update")] },
	)
	// Delete — auth + delete permission
	.delete(
		"/:id",
		async ({ container, params }) => deleteProduct(params, container as Container),
		{ beforeHandle: [can("product", "delete")] },
	);
```

The inline closures that remain are intentionally minimal — they only adapt the Elysia request context (`container`, `body`, `params`, `set.status`) into the controller function's plain typed arguments. All business logic has moved out of the route file.

### How the request pipeline works under the hood

`routeGroup()` assembles the middleware stack once; Elysia executes it in declaration order before any route handler runs:

1. **`shipContext`** (via `routeGroup`) — decorates every route with `db`, `log`, and `container`, and registers the global `onError` handler. The `as: "global"` option on the error handler is critical: without it, Elysia keeps lifecycle hooks local-scoped and errors thrown inside container routes would never be caught.
2. **`authContext`** (via `routeGroup`, skipped for the `"auth"` preset) — a scoped `derive` that extracts the bearer token (or `session_token` cookie), calls `AuthBridgePort.validateToken(token)` through the container, and attaches the resulting `SessionDTO` as `ctx.currentUser` (or `undefined` if no/invalid token).
3. **`onBeforeHandle(rateLimitMiddleware(...))`** (via `routeGroup`) — applies the preset's rate limit (`api` = 60 requests/minute by default) to every route in the group. The store is resolved from the container, so it is `RedisRateLimitStore` in prod and `InMemoryRateLimitStore` in dev.
4. **Per-route `beforeHandle: [can("product", "read")]`** — the RBAC check. `can(resource, action)` throws `ForbiddenError` (HTTP 403) if `ctx.currentUser` is missing or lacks the permission. The `Create` route omits this because registration is open.

The `can()` middleware reads permissions from `ctx.currentUser.permissions`, which were loaded by the AuthBridge when the token was validated:

```ts
// src/Ship/Http/canMiddleware.ts
export function can(resource: string, action: string) {
	return (ctx: AuthedContext) => {
		if (!ctx.currentUser) {
			throw new ForbiddenError("Authentication required.");
		}
		const userPermissions = ctx.currentUser.permissions ?? [];
		if (!hasPermission(userPermissions, { resource, action })) {
			throw new ForbiddenError();
		}
	};
}
```

### The response envelope

Every controller returns `wrapResponse(data)` or `wrapPaginated(data, meta)`, both standalone functions exported from `MainController.ts`. They produce the `{ data, meta }` envelope:

```ts
// src/Ship/Http/MainController.ts
export function wrapResponse<TData>(data: TData): ResponseEnvelope<TData> {
	return { data, meta: {} };
}

export function wrapPaginated<TData>(
	data: TData[],
	meta: PaginatedMeta,
): ResponseEnvelope<TData[], PaginatedMeta> {
	return { data, meta };
}
```

`MainController` also still defines an abstract `MainController` class with a protected `wrap()` helper, but routes no longer extend it — the standalone functions are the modern entry point. Clients can therefore parse every Thalys response the same way: read `data` for the payload, `meta` for pagination/extra info.

## Step 6 — Generate the migration

The schema file exists in `src/Containers/Product/Models/product.schema.ts`, but the `products` table does not exist in Postgres yet. Drizzle Kit generates a SQL migration by diffing your `*.schema.ts` files against the database:

```bash
bun run db:generate
```

You will see output like:

```bash
[*] Reading drizzle config...
[*] Pulling schema from database...
[*] Generating migrations...
[*] You have 1 new migration:
    → 0001_create_products_table.sql
```

The generated SQL (in `drizzle/0001_create_products_table.sql`) reflects exactly what the schema declares:

```sql
CREATE TABLE IF NOT EXISTS "products" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
```

::: tip Drizzle only scans `*.schema.ts`
Drizzle Kit's config is scoped to `Models/*.schema.ts`. Non-Postgres models (e.g. a MongoDB document type) must **not** use the `.schema.ts` suffix, or `db:generate` will try to create a Postgres table for them.
:::

## Step 7 — Apply the migration

Apply pending migrations to your Postgres database:

```bash
bun run db:migrate
```

This runs `drizzle-kit migrate`, which executes every unapplied SQL file in `drizzle/` against the database configured in `APP_DATABASE_URL`. The `products` table now exists.

::: warning Tunnel must be up
`db:migrate` connects to `APP_DATABASE_URL` (i.e. `localhost:30001` over the SSH tunnel). If the tunnel is down, the migration fails with a connection error. Verify the tunnel before running migrations — see [Installation](./installation#the-dev-server-tunnel-setup).
:::

## Step 8 — Start the server and test

Start the dev server:

```bash
bun run dev
# 🦊 Elysia running on Bun  host=localhost port=3000
```

### Create a product (open — no auth)

```bash
curl -X POST http://localhost:3000/api/v1/products \
  -H "Content-Type: application/json" \
  -d '{"name":"Thalys T-Shirt"}'
```

```json
{
  "data": {
    "id": "0192f8a3-1b2c-7d4e-9f01-234567890abc",
    "name": "Thalys T-Shirt",
    "createdOn": "2026-06-30T12:00:00.000Z"
  },
  "meta": {}
}
```

The `id` is a UUIDv7 generated by Drizzle's `$defaultFn` — time-ordered, globally unique.

### List without auth → 403

```bash
curl http://localhost:3000/api/v1/products
```

```json
{
  "success": false,
  "error": "FORBIDDEN",
  "message": "Authentication required."
}
```

The `can("product", "read")` guard fired because no bearer token was provided.

### List with a valid token

First, seed roles and a user, then log in to get a bearer token:

```bash
bun run command db:seed:roles
# → Seeded roles + permissions

# (create a user via the auth flow, or seed one)
bun run command db:seed:users --count 1 --password password123
```

Then authenticate (the exact flow depends on your Auth container's login endpoint):

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}' \
  | jq -r '.data.token')
```

Now list with the token:

```bash
curl http://localhost:3000/api/v1/products \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "data": [
    {
      "id": "0192f8a3-1b2c-7d4e-9f01-234567890abc",
      "name": "Thalys T-Shirt",
      "createdOn": "2026-06-30T12:00:00.000Z"
    }
  ],
  "meta": {
    "total": 1,
    "cursor": "0192f8a3-1b2c-7d4e-9f01-234567890abc",
    "hasMore": false
  }
}
```

### Get, update, delete

```bash
# Detail
curl http://localhost:3000/api/v1/products/0192f8a3-1b2c-7d4e-9f01-234567890abc \
  -H "Authorization: Bearer $TOKEN"

# Update
curl -X PATCH http://localhost:3000/api/v1/products/0192f8a3-1b2c-7d4e-9f01-234567890abc \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Thalys Hoodie"}'

# Delete
curl -X DELETE http://localhost:3000/api/v1/products/0192f8a3-1b2c-7d4e-9f01-234567890abc \
  -H "Authorization: Bearer $TOKEN"
```

### Rate limiting in action

Hit the list endpoint 61 times within a minute and the 61st request returns:

```json
{
  "success": false,
  "error": "RATE_LIMIT_EXCEEDED",
  "message": "Too many requests. Please try again later."
}
```

The `api` preset allows 60 requests per 60-second window. In production with `REDIS_URL` set, this limit is shared across all replicas via `RedisRateLimitStore`.

## Step 9 — How auto-registration works

Notice that you never manually edited `registerServices.ts` or `index.ts`. The `thalys:make:container` command did it for you using **marker comments** — special comments that act as insertion points for the generator.

There are three markers, in two files:

### `GENERATOR_IMPORTS` — imports in `registerServices.ts`

```ts
// src/Ship/Container/registerServices.ts
import { HashPasswordTask } from "@containers/User/Tasks/HashPasswordTask";
// [GENERATOR_IMPORTS]#123;[GENERATOR_IMPORTS]#123;GENERATOR_IMPORTS[GENERATOR_IMPORTS]#125;[GENERATOR_IMPORTS]#125;
import { CreateProductAction } from "@containers/Product/Actions/CreateProductAction";
import { UpdateProductAction } from "@containers/Product/Actions/UpdateProductAction";
import { DeleteProductAction } from "@containers/Product/Actions/DeleteProductAction";
import { ProductRepository } from "@containers/Product/Models/ProductRepository";
// [GENERATOR_IMPORTS]#123;[GENERATOR_IMPORTS]#123;GENERATOR_IMPORTS[GENERATOR_IMPORTS]#125;[GENERATOR_IMPORTS]#125;
```

### `GENERATOR_BINDINGS` — DI bindings in `registerServices.ts`

```ts
// src/Ship/Container/registerServices.ts
	container.bind(DeleteUserAction, "db", UserRepository);

	// [GENERATOR_BINDINGS]#123;[GENERATOR_BINDINGS]#123;GENERATOR_BINDINGS[GENERATOR_BINDINGS]#125;[GENERATOR_BINDINGS]#125;
	container.bind(ProductRepository, "db");
	container.bind(CreateProductAction, "db", ProductRepository);
	container.bind(UpdateProductAction, "db", ProductRepository);
	container.bind(DeleteProductAction, "db", ProductRepository);
	// [GENERATOR_BINDINGS]#123;[GENERATOR_BINDINGS]#123;GENERATOR_BINDINGS[GENERATOR_BINDINGS]#125;[GENERATOR_BINDINGS]#125;
```

### `GENERATOR_ROUTE_IMPORTS` and `GENERATOR_ROUTE_MOUNTS` — in `index.ts`

```ts
// src/index.ts
import { userRoutesV1 } from "./Containers/User/UI/API/v1/routes";
// [GENERATOR_ROUTE_IMPORTS]#123;[GENERATOR_ROUTE_IMPORTS]#123;GENERATOR_ROUTE_IMPORTS[GENERATOR_ROUTE_IMPORTS]#125;[GENERATOR_ROUTE_IMPORTS]#125;
import { productRoutesV1 } from "./Containers/Product/UI/API/v1/routes";
// [GENERATOR_ROUTE_IMPORTS]#123;[GENERATOR_ROUTE_IMPORTS]#123;GENERATOR_ROUTE_IMPORTS[GENERATOR_ROUTE_IMPORTS]#125;[GENERATOR_ROUTE_IMPORTS]#125;
import { container } from "./Ship/setup";

const app = new Elysia({ prefix: "/api" })
	.use(authRoutesV1)
	.use(userRoutesV1)
	// [GENERATOR_ROUTE_MOUNTS]#123;[GENERATOR_ROUTE_MOUNTS]#123;GENERATOR_ROUTE_MOUNTS[GENERATOR_ROUTE_MOUNTS]#125;[GENERATOR_ROUTE_MOUNTS]#125;
	.use(productRoutesV1)
	// [GENERATOR_ROUTE_MOUNTS]#123;[GENERATOR_ROUTE_MOUNTS]#123;GENERATOR_ROUTE_MOUNTS[GENERATOR_ROUTE_MOUNTS]#125;[GENERATOR_ROUTE_MOUNTS]#125;
	.listen(process.env.PORT ?? 3000);
```

### How the insertion works

The `FileGenerator.insertIntoFile()` method reads the target file, finds the marker comment, and inserts the new line **above** the marker — then writes the file back. It also deduplicates: if the exact line already exists, it skips the insertion (so re-running the command with `--force` does not produce duplicate imports).

```ts
// src/Ship/Generators/FileGenerator.ts
insertIntoFile(filePath: string, marker: string, lineToInsert: string): void {
	const content = readFileSync(filePath, "utf-8");
	if (content.includes(lineToInsert)) return;            // idempotent
	const updated = content.replace(marker, `${lineToInsert}\n${marker}`);
	writeFileSync(filePath, updated, "utf-8");
}
```

This is why `thalys:make:container` reports `registered: true` — the new container's actions, repository, and routes are wired into the running application without you touching a config file. The markers remain in the files permanently, so the next `make:container` call inserts above them again.

::: tip Never delete the markers
The `// [GENERATOR_*]#123;[GENERATOR_*]#123;GENERATOR_*[GENERATOR_*]#125;[GENERATOR_*]#125;` comments look like dead code, but they are load-bearing. If you remove them, future `thalys:make:*` commands will have nowhere to insert and will fail. Leave them in place.
:::

## Recap

In this tutorial you:

1. Ran **one command** (`thalys:make:container Product --crud`) to generate 14 files across 8 directories.
2. Saw the **UUIDv7 primary key** pattern and why time-ordered IDs matter at scale.
3. Learned how **`BaseRepository<T>`** provides CRUD + cursor pagination, and how `withTransaction(tx)` scopes a repository to a transaction.
4. Understood why **Actions are the transaction boundary** — they are the only layer that calls `db.transaction(...)`.
5. Saw the **controller function pattern** — one plain `async function` per endpoint in `UI/API/Controllers/`, keeping `routes.ts` as thin wiring.
6. Walked the **request pipeline**: `routeGroup()` (`shipContext` → `authContext` → rate limit) → `beforeHandle` RBAC `can()` → controller function → Action → Transformer → `wrapResponse()`.
7. Generated and applied a **Drizzle migration**.
8. Tested all five endpoints with **curl**, including the 403 and 429 error paths.
9. Learned how **marker comments** enable zero-config auto-registration.

From here, the natural next steps are:

- **[Architecture: Ship vs Containers](/architecture/ship-vs-containers)** — the deep dive on the two-layer split.
- **[Architecture: Bridge Pattern](/architecture/bridge-pattern)** — how to make one container call another without breaking isolation.
- **[CLI Reference: make:container](/cli/make-container)** — every flag and stub variant.
- **[Guides: RBAC & Permissions](/guides/rbac)** — how to define permissions and assign them to roles.
