# CRUD Scaffold

Thalys can scaffold a complete CRUD container — schema, repository, requests, actions, transformer, and routes — from a single command. This guide walks through what gets generated, how auto-registration works, and how to customise the result.

## Generating a container

```bash
bun run command thalys:make:container Product --crud
```

This creates a `Product` container under `src/Containers/Product/` with the full Porto layering and wires it into the application automatically.

::: tip Bare skeleton
Omit `--crud` to generate a bare container with just the directory structure and an empty routes file. Useful when you need a custom domain that doesn't fit the CRUD pattern.
:::

Use `--force` to overwrite an existing container:

```bash
bun run command thalys:make:container Product --crud --force
```

## The 14 generated files

With `--crud`, the generator produces these files:

| # | File | Layer | Purpose |
| --- | --- | --- | --- |
| 1 | `Models/product.schema.ts` | Model | Drizzle `pgTable` definition |
| 2 | `Models/ProductRepository.ts` | Model | Repository with CRUD + pagination |
| 3 | `Requests/product.request.ts` | Request | TypeBox schemas for create/update DTOs |
| 4 | `Requests/list-products.request.ts` | Request | Pagination query params schema |
| 5 | `Actions/CreateProductAction.ts` | Action | Create one product |
| 6 | `Actions/UpdateProductAction.ts` | Action | Update one product |
| 7 | `Actions/DeleteProductAction.ts` | Action | Delete one product |
| 8 | `Transformers/ProductTransformer.ts` | Transformer | Shapes the client-facing output |
| 9 | `UI/API/Controllers/createProduct.ts` | UI/API | Create controller function |
| 10 | `UI/API/Controllers/listProducts.ts` | UI/API | List controller function |
| 11 | `UI/API/Controllers/getProduct.ts` | UI/API | Get-one controller function |
| 12 | `UI/API/Controllers/updateProduct.ts` | UI/API | Update controller function |
| 13 | `UI/API/Controllers/deleteProduct.ts` | UI/API | Delete controller function |
| 14 | `UI/API/v1/routes.ts` | UI/API | Thin route wiring — delegates to controllers |

The directory structure:

```txt
src/Containers/Product/
├── Actions/
│   ├── CreateProductAction.ts
│   ├── UpdateProductAction.ts
│   └── DeleteProductAction.ts
├── Tasks/
├── Models/
│   ├── product.schema.ts
│   └── ProductRepository.ts
├── Transformers/
│   └── ProductTransformer.ts
├── Requests/
│   ├── product.request.ts
│   └── list-products.request.ts
└── UI/
    ├── API/
    │   ├── Controllers/
    │   │   ├── createProduct.ts
    │   │   ├── listProducts.ts
    │   │   ├── getProduct.ts
    │   │   ├── updateProduct.ts
    │   │   └── deleteProduct.ts
    │   └── v1/
    │       └── routes.ts
    └── Command/
```

## How auto-registration works

The generator does not just create files — it patches `registerServices.ts` and `index.ts` using marker comments. Three markers exist:

```ts
// src/Ship/Container/registerServices.ts

// [GENERATOR_IMPORTS]#123;[GENERATOR_IMPORTS]#123;GENERATOR_IMPORTS[GENERATOR_IMPORTS]#125;[GENERATOR_IMPORTS]#125;   ← import statements are inserted here
// [GENERATOR_BINDINGS]#123;[GENERATOR_BINDINGS]#123;GENERATOR_BINDINGS[GENERATOR_BINDINGS]#125;[GENERATOR_BINDINGS]#125;  ← container.bind() calls are inserted here
// [GENERATOR_LISTENERS]#123;[GENERATOR_LISTENERS]#123;GENERATOR_LISTENERS[GENERATOR_LISTENERS]#125;[GENERATOR_LISTENERS]#125; ← event listener registrations go here
```

```ts
// src/index.ts

// [GENERATOR_ROUTE_IMPORTS]#123;[GENERATOR_ROUTE_IMPORTS]#123;GENERATOR_ROUTE_IMPORTS[GENERATOR_ROUTE_IMPORTS]#125;[GENERATOR_ROUTE_IMPORTS]#125;  ← route import statements
// [GENERATOR_ROUTE_MOUNTS]#123;[GENERATOR_ROUTE_MOUNTS]#123;GENERATOR_ROUTE_MOUNTS[GENERATOR_ROUTE_MOUNTS]#125;[GENERATOR_ROUTE_MOUNTS]#125;   ← .use(routeVar) calls
```

When you run `thalys:make:container Product --crud`, the generator inserts:

```ts
// Into registerServices.ts (imports):
import { CreateProductAction } from "@containers/Product/Actions/CreateProductAction";
import { UpdateProductAction } from "@containers/Product/Actions/UpdateProductAction";
import { DeleteProductAction } from "@containers/Product/Actions/DeleteProductAction";
import { ProductRepository } from "@containers/Product/Models/ProductRepository";

// Into registerServices.ts (bindings):
container.bind(ProductRepository, "db");
container.bind(CreateProductAction, "db", ProductRepository);
container.bind(UpdateProductAction, "db", ProductRepository);
container.bind(DeleteProductAction, "db", ProductRepository);

// Into index.ts:
import { productRoutesV1 } from "./Containers/Product/UI/API/v1/routes";
// ...
.use(productRoutesV1)
```

::: warning Don't delete the markers
The marker comments are how the generator knows where to insert new code. If you remove them, future `thalys:make:*` commands will fail to auto-register. You can move them (e.g. to keep imports alphabetised), but keep the exact comment text intact.
:::

## The generated routes pattern

The scaffolded routes follow a consistent pattern — open create, permission-gated everything else:

| Method | Path | Auth | Permission | Description |
| --- | --- | --- | --- | --- |
| POST | `/api/v1/products` | None | — | Create a product |
| GET | `/api/v1/products` | Bearer token | `product/read` | List products (paginated) |
| GET | `/api/v1/products/:id` | Bearer token | `product/read` | Get one product |
| PATCH | `/api/v1/products/:id` | Bearer token | `product/update` | Update a product |
| DELETE | `/api/v1/products/:id` | Bearer token | `product/delete` | Delete a product |

Route files are thin wiring — they import controller functions and delegate. The `routeGroup()` helper in `src/Ship/Http/routeGroup.ts` replaces the repeated `.use(shipContext).use(authContext).onBeforeHandle(rateLimit)` block. The default `"api"` preset includes `authContext` (which derives `currentUser`); pass `"auth"` to skip it for login/register routes.

Each controller function lives in its own file under `UI/API/Controllers/` and is a plain `async function` that takes typed input + a `Container`, calls Actions, transforms the result, and returns `wrapResponse(...)`. Here is the create controller (using `User` as an example of the pattern):

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

The generated routes file imports the five controller functions and wires them:

```ts
// src/Containers/User/UI/API/v1/routes.ts
import { createUser } from "@containers/User/UI/API/Controllers/createUser";
import { deleteUser } from "@containers/User/UI/API/Controllers/deleteUser";
import { getUser } from "@containers/User/UI/API/Controllers/getUser";
import { listUsers } from "@containers/User/UI/API/Controllers/listUsers";
import { updateUser } from "@containers/User/UI/API/Controllers/updateUser";
import type { Container } from "@ship/Container/Container";
import { can } from "@ship/Http/canMiddleware";
import { routeGroup } from "@ship/Http/routeGroup";

export const userRoutesV1 = routeGroup("/v1/users")
	.post(
		"/",
		async ({ container, body, set }) => {
			set.status = 201;
			return createUser(body, container as Container);
		},
		{ body: CreateUserRequest },
	)
	.get("/", async ({ container, query }) => listUsers(query, container as Container), {
		beforeHandle: [can("user", "read")],
	})
	.get("/:id", async ({ container, params }) => getUser(params, container as Container), {
		beforeHandle: [can("user", "read")],
	})
	// ... update, delete follow the same pattern
```

## Rate limiting presets

Every route group gets a rate limit applied via `onBeforeHandle` inside `routeGroup()`. Thalys ships with three presets:

```ts
// src/Ship/Http/rateLimitPresets.ts
export const RATE_LIMIT_PRESETS = {
	auth: { limit: 5, windowMs: 60_000 },     // login/register/logout
	api: { limit: 60, windowMs: 60_000 },     // authenticated API routes
	public: { limit: 120, windowMs: 60_000 }, // public read routes
} as const;
```

The CRUD scaffold uses `api` (60/min) for all routes. Auth routes use the `auth` preset (5/min) because brute-force attempts on login/register must be throttled aggressively.

The rate limiter identifies clients by `x-forwarded-for` or `x-real-ip` header, falling back to `"anonymous"`. When `REDIS_URL` is set, rate limits are shared across all processes via `RedisRateLimitStore`; otherwise `InMemoryRateLimitStore` is used (per-process).

## Customising the generated schema

The generated schema is a starting point. Add columns to fit your domain:

```ts
// src/Containers/Product/Models/product.schema.ts
import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

export const productsTable = pgTable("products", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => uuidv7()),
	name: text("name").notNull(),
	sku: text("sku").notNull().unique(),
	price: integer("price").notNull(),
	active: boolean("active").notNull().default(true),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

After editing the schema, generate and apply the migration:

```bash
bun run db:generate    # creates a SQL migration file from schema changes
bun run db:migrate     # applies the migration to the database
```

::: tip Only *.schema.ts files are scanned
Drizzle Kit only scans files matching `*.schema.ts`. If you split your schema across multiple files, name them `product.schema.ts`, `category.schema.ts`, etc. The repository file (`ProductRepository.ts`) is not scanned.
:::

You should also update the transformer to expose (or hide) the new columns:

```ts
// src/Containers/Product/Transformers/ProductTransformer.ts
export class ProductTransformer extends BaseTransformer<RawProductEntity, SafeProductOutput> {
	transform(product: RawProductEntity): SafeProductOutput {
		return {
			id: product.id,
			name: product.name,
			sku: product.sku,
			price: product.price,
			active: product.active,
		};
	}
}
```

And update the request schemas to accept the new fields for create/update:

```ts
// src/Containers/Product/Requests/product.request.ts
export const CreateProductRequest = Type.Object({
	name: Type.String({ minLength: 1 }),
	sku: Type.String({ minLength: 1 }),
	price: Type.Integer({ minimum: 0 }),
});
```

## Adding custom Actions beyond CRUD

The scaffold generates Create, Update, and Delete Actions. For domain-specific operations (e.g. `PublishProductAction`, `ArchiveProductAction`), create a new Action:

```bash
bun run command thalys:make:action Product PublishProduct
```

This generates a stub. Implement it:

```ts
// src/Containers/Product/Actions/PublishProductAction.ts
export class PublishProductAction extends BaseAction {
	constructor(
		db: AppDB,
		private readonly productRepo: ProductRepository,
	) {
		super(db);
	}

	async execute(id: string): Promise<RawProductEntity> {
		return await this.withTransaction(async (tx) => {
			const repo = this.productRepo.withTransaction(tx);
			const updated = await repo.update(id, { active: true });
			if (!updated) throw new NotFoundError("Product");
			return updated;
		});
	}
}
```

Register it in the container (add to the `GENERATOR_BINDINGS` section):

```ts
container.bind(PublishProductAction, "db", ProductRepository);
```

Then create a controller function and add a route that delegates to it:

```ts
// src/Containers/Product/UI/API/Controllers/publishProduct.ts
import { PublishProductAction } from "@containers/Product/Actions/PublishProductAction";
import { ProductTransformer } from "@containers/Product/Transformers/ProductTransformer";
import type { Container } from "@ship/Container/Container";
import { BaseRequest } from "@ship/Http/BaseRequest";
import { wrapResponse } from "@ship/Http/MainController";

const transformer = new ProductTransformer();

export async function publishProduct(params: { id: string }, container: Container) {
	const id = BaseRequest.validateId(params.id);
	const action = container.make(PublishProductAction);
	const product = await action.execute(id);
	return wrapResponse(transformer.transform(product));
}
```

Wire it into the route group:

```ts
.post(
	"/:id/publish",
	async ({ container, params }) => publishProduct(params, container as Container),
	{ beforeHandle: [can("product", "update")] },
)
```

## Running the migration and testing

After scaffolding and customising:

```bash
# 1. Generate the SQL migration
bun run db:generate

# 2. Apply it
bun run db:migrate

# 3. Seed roles (if not already done)
bun run command db:seed:roles

# 4. Start the server
bun run dev
```

Test the endpoints with curl:

```bash
# Register to get a token
TOKEN=$(curl -sX POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Admin","email":"admin@test.com","password":"password123"}' \
  | jq -r '.data.token')

# Create a product
curl -X POST http://localhost:3000/api/v1/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Widget","sku":"WDG-001","price":1999}'

# List products (requires product/read permission)
curl http://localhost:3000/api/v1/products \
  -H "Authorization: Bearer $TOKEN"

# Get one product
curl http://localhost:3000/api/v1/products/<id> \
  -H "Authorization: Bearer $TOKEN"

# Update
curl -X PATCH http://localhost:3000/api/v1/products/<id> \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"price":2499}'

# Delete
curl -X DELETE http://localhost:3000/api/v1/products/<id> \
  -H "Authorization: Bearer $TOKEN"
```

::: warning First request returns 403
A newly registered user has no role assigned, so their permissions array is empty. The `can("product", "read")` check will return `403`. Assign the `admin` role (which has `*/*` permissions) to the user in the database, or seed a role with the specific permissions you need. See the [RBAC guide](./rbac).
:::

## Extension: adding Controllers for multi-Action routes

As a container grows, you may want to group related logic beyond the five CRUD operations. Each controller is a plain `async function` in its own file under `UI/API/Controllers/` — it takes typed input + a `Container`, calls Actions, transforms the result, and returns `wrapResponse(...)`. There is no base class to extend; the `MainController` module in `src/Ship/Http/MainController.ts` only exports the `wrapResponse` / `wrapPaginated` helpers.

Generate a controller stub:

```bash
bun run command thalys:make:controller Product
```

A controller function looks like this:

```ts
// src/Containers/Product/UI/API/Controllers/archiveProduct.ts
import { ArchiveProductAction } from "@containers/Product/Actions/ArchiveProductAction";
import { ProductTransformer } from "@containers/Product/Transformers/ProductTransformer";
import type { Container } from "@ship/Container/Container";
import { BaseRequest } from "@ship/Http/BaseRequest";
import { wrapResponse } from "@ship/Http/MainController";

const transformer = new ProductTransformer();

export async function archiveProduct(params: { id: string }, container: Container) {
	const id = BaseRequest.validateId(params.id);
	const action = container.make(ArchiveProductAction);
	const product = await action.execute(id);
	return wrapResponse(transformer.transform(product));
}
```

Wire it into the existing route group in `routes.ts`:

```ts
import { archiveProduct } from "@containers/Product/UI/API/Controllers/archiveProduct";

// Inside the existing routeGroup("/v1/products") chain:
.post(
	"/:id/archive",
	async ({ container, params }) => archiveProduct(params, container as Container),
	{ beforeHandle: [can("product", "update")] },
)
```

Controllers are purely organisational — they don't change the Porto layering. Use them when you want to group routes by sub-resource (e.g. `ProductController` for CRUD, `ProductInventoryController` for stock management).
