# make:middleware

The `thalys:make:middleware` command creates a new Elysia middleware plugin. Middleware in Thalys is implemented as an Elysia instance with a `name` and lifecycle hooks (e.g. `onBeforeHandle`), which can be `.use()`'d into any route group.

## Signature

```bash
thalys:make:middleware {name} {--f|force}
```

## Arguments

| Argument | Description |
| --- | --- |
| `name` | The middleware name. The `Middleware` suffix is appended automatically (e.g. `Audit` → `AuditMiddleware`). |

## Options

| Option | Shortcut | Description |
| --- | --- |
| `--force` | `-f` | Overwrite the file if it already exists. |

## What it generates

Creates a single file in the Ship layer (middleware is shared infrastructure, not container-specific):

```txt
src/Ship/Http/Middleware/<Name>Middleware.ts
```

The generated file exports an Elysia instance with a `name` option (kebab-case) and an `onBeforeHandle` hook stub. The `name` is required by Elysia for plugin scoping — it prevents state from leaking between mounted instances.

## Example usage

```bash
bun run command thalys:make:middleware Audit

bun run command thalys:make:middleware RequestId --force
```

Output:

```bash
Created AuditMiddleware  path=src/Ship/Http/Middleware/AuditMiddleware.ts
```

## Generated file example

```ts
// src/Ship/Http/Middleware/AuditMiddleware.ts
import { Elysia } from "elysia";

export const auditMiddleware = new Elysia({ name: "audit" })
	.onBeforeHandle(async ({ set }) => {
		// TODO: implement middleware logic
	});
```

::: tip Mount middleware in a route group
Route files use the `routeGroup()` helper (`src/Ship/Http/routeGroup.ts`) instead of chaining `.use(shipContext).use(authContext).onBeforeHandle(ratelimit)` by hand. `routeGroup()` wires the standard setup — `shipContext`, `authContext`, and the rate-limit middleware — internally. To add your own middleware, call `.use()` on the group it returns:

```ts
import { routeGroup } from "@ship/Http/routeGroup";
import { auditMiddleware } from "@ship/Http/Middleware/AuditMiddleware";

export const productRoutesV1 = routeGroup("/v1/products")
	.use(auditMiddleware)
	.get("/", handler);
```

Custom middleware plugins are still registered via `.use()` on an Elysia instance. The middleware runs on every request in the group, before the route handler.
:::

::: tip Why middleware lives in Ship
Middleware is cross-cutting infrastructure — it applies to multiple containers and domains. Placing it in `Ship/Http/Middleware/` keeps the dependency direction one-way: containers import from Ship, never the reverse. If a middleware is truly container-specific, you can create it inside the container's directory manually.
:::
