# make:container

The `thalys:make:container` command scaffolds a complete Porto container — the isolated business domain structure that holds your Actions, Tasks, Models, Transformers, Requests, and UI routes. It is the single entry point for adding a new domain to a Thalys application.

## Signature

```bash
thalys:make:container {name} {--crud} {--f|force}
```

## Arguments

| Argument | Description |
| --- | --- |
| `name` | The container name. Automatically converted to `PascalCase` (e.g. `Product`, `blog-post` → `BlogPost`). |

## Options

| Option | Shortcut | Description |
| --- | --- | --- |
| `--crud` | | Scaffold the full CRUD stack: schema, repository, two request schemas, three actions, a transformer, and CRUD routes. |
| `--force` | `-f` | Overwrite existing files if the container directory already exists. |

## What it generates

### Without `--crud` (bare skeleton)

Creates the container directory tree with seven subdirectories and a single bare routes file:

```txt
src/Containers/<Name>/
├── Actions/
├── Tasks/
├── Models/
├── Transformers/
├── Requests/
├── UI/API/v1/
│   └── routes.ts          # bare routeGroup() with shipContext + authContext + rate limit
└── UI/Command/
```

The routes file is auto-registered in `src/index.ts` so the new container is immediately mounted on the running server.

### With `--crud` (full CRUD stack)

Generates **14 files** across 8 directories:

```txt
src/Containers/<Name>/
├── Models/
│   ├── <name>.schema.ts             # Drizzle pgTable (UUIDv7 PK, name, createdAt, updatedAt)
│   └── <Name>Repository.ts          # extends BaseRepository
├── Requests/
│   ├── <name>.request.ts            # Create<Name>Request + Update<Name>Request (TypeBox)
│   └── list-<names>.request.ts      # List<Name>sRequest (filter/sort/pagination allowlist)
├── Actions/
│   ├── Create<Name>Action.ts        # transactional create
│   ├── Update<Name>Action.ts        # transactional update (checks existence)
│   └── Delete<Name>Action.ts        # transactional delete (checks existence)
├── Transformers/
│   └── <Name>Transformer.ts         # Raw<Name> → Safe<Name>Output
└── UI/API/
    ├── Controllers/                 # one function per CRUD operation
    │   ├── create<Name>.ts          # create<Name>(body, container)
    │   ├── list<Name>s.ts           # list<Name>s(query, container)
    │   ├── get<Name>.ts             # get<Name>(params, container)
    │   ├── update<Name>.ts          # update<Name>(params, body, container)
    │   └── delete<Name>.ts          # delete<Name>(params, container)
    └── v1/
        └── routes.ts                # 5 endpoints via routeGroup() + RBAC + rate limiting
```

Each controller function is a standalone `async function` that imports the Action/repository and Transformer, calls them, and returns `wrapResponse(...)` / `wrapPaginated(...)`. The routes file imports these functions and delegates — it contains no Action or Transformer logic of its own.

### Auto-registration

In both modes, the command edits two existing files using marker comments as insertion points:

- **`src/Ship/Container/registerServices.ts`** — adds imports and DI bindings for the repository and all three actions (CRUD mode only), inserted above the `// [GENERATOR_IMPORTS]#123;[GENERATOR_IMPORTS]#123;GENERATOR_IMPORTS[GENERATOR_IMPORTS]#125;[GENERATOR_IMPORTS]#125;` and `// [GENERATOR_BINDINGS]#123;[GENERATOR_BINDINGS]#123;GENERATOR_BINDINGS[GENERATOR_BINDINGS]#125;[GENERATOR_BINDINGS]#125;` markers.
- **`src/index.ts`** — adds the route import and `.use(<name>RoutesV1)` mount, inserted above the `// [GENERATOR_ROUTE_IMPORTS]#123;[GENERATOR_ROUTE_IMPORTS]#123;GENERATOR_ROUTE_IMPORTS[GENERATOR_ROUTE_IMPORTS]#125;[GENERATOR_ROUTE_IMPORTS]#125;` and `// [GENERATOR_ROUTE_MOUNTS]#123;[GENERATOR_ROUTE_MOUNTS]#123;GENERATOR_ROUTE_MOUNTS[GENERATOR_ROUTE_MOUNTS]#125;[GENERATOR_ROUTE_MOUNTS]#125;` markers.

::: tip Marker comments are load-bearing
The `// [GENERATOR_*]#123;[GENERATOR_*]#123;GENERATOR_*[GENERATOR_*]#125;[GENERATOR_*]#125;` comments look like dead code, but they are insertion anchors for the code generator. Never delete them — future `thalys:make:*` commands will fail if the markers are missing. The insertion is idempotent: re-running with `--force` does not produce duplicate lines.
:::

## Example usage

```bash
# Full CRUD container
bun run command thalys:make:container Product --crud

# Bare skeleton (routes only)
bun run command thalys:make:container Blog

# Overwrite an existing container
bun run command thalys:make:container Product --crud --force
```

Output:

```bash
Scaffolded Product container with full CRUD  container=src/Containers/Product  files=14  crud=true  registered=true
```

## Generated file examples

### Routes (CRUD mode)

Routes are thin wiring — they import controller functions and delegate. The repeated `.use(shipContext).use(authContext).onBeforeHandle(rateLimitMiddleware(...))` block is replaced by a single `routeGroup()` call. Action, repository, and Transformer imports live in the controller files, not here.

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
	.post(
		"/",
		async ({ container, body, set }) => {
			set.status = 201;
			return createProduct(body, container as Container);
		},
		{ body: CreateProductRequest },
	)
	.get(
		"/",
		async ({ container, query }) => listProducts(query, container as Container),
		{ beforeHandle: [can("product", "read")] },
	)
	.get(
		"/:id",
		async ({ container, params }) => getProduct(params, container as Container),
		{ beforeHandle: [can("product", "read")] },
	)
	.patch(
		"/:id",
		async ({ container, params, body }) =>
			updateProduct(params, body, container as Container),
		{ body: UpdateProductRequest, beforeHandle: [can("product", "update")] },
	)
	.delete(
		"/:id",
		async ({ container, params }) => deleteProduct(params, container as Container),
		{ beforeHandle: [can("product", "delete")] },
	);
```

For reference, here is one of the generated controller functions the routes delegate to (`createProduct`):

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

### Routes (bare skeleton mode)

```ts
// src/Containers/Blog/UI/API/v1/routes.ts
import { routeGroup } from "@ship/Http/routeGroup";

export const blogRoutesV1 = routeGroup("/v1/blogs");
```

`routeGroup(prefix)` defaults to the `"api"` preset, which applies `shipContext` (db/log/container), `authContext` (current user), and API rate limiting. Pass `"auth"` as the second argument for routes that don't require an existing session (e.g. login, register) — it skips `authContext`:

```ts
routeGroup("/v1/auth", "auth");
```

::: tip Start bare, add CRUD later
If you are prototyping and only need the route group mounted, use the bare skeleton. You can always run `thalys:make:action`, `thalys:make:repository`, and `thalys:make:transformer` individually afterward to build out the domain incrementally.
:::
