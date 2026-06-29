# make:request

The `thalys:make:request` command creates a new TypeBox validation schema — the input validation layer that Elysia uses to parse and validate request bodies. Each request schema produces a static DTO type that propagates through the Action layer.

## Signature

```bash
thalys:make:request {container} {name} {--f|force}
```

## Arguments

| Argument | Description |
| --- | --- |
| `container` | The target container name (PascalCase, e.g. `Product`). |
| `name` | The request name. The `Request` suffix is appended to the schema constant and `DTO` to the type (e.g. `Create` → `CreateRequest` / `CreateDTO`). |

## Options

| Option | Shortcut | Description |
| --- | --- |
| `--force` | `-f` | Overwrite the file if it already exists. |

## What it generates

Creates a single file with a kebab-case filename:

```txt
src/Containers/<Container>/Requests/<name>.request.ts
```

The file exports a TypeBox `t.Object()` schema and a `Static<typeof ...>` DTO type. The filename uses kebab-case (e.g. `create-product.request.ts`), while the exported constants use PascalCase.

## Example usage

```bash
bun run command thalys:make:request Product CreateProduct

bun run command thalys:make:request Order ProcessRefund --force
```

Output:

```bash
Created CreateProductRequest  path=src/Containers/Product/Requests/create-product.request.ts
```

## Generated file example

```ts
// src/Containers/Product/Requests/create-product.request.ts
import { type Static, t } from "elysia";

export const CreateProductRequest = t.Object({
	// TODO: add fields
});

export type CreateProductDTO = Static<typeof CreateProductRequest>;
```

::: tip TypeBox gives you compile-time safety
The `Static<typeof CreateProductRequest>` type is inferred from the schema definition. When you add a field like `name: t.String({ minLength: 2 })`, the DTO type updates automatically — no manual interface to keep in sync.
:::

::: tip Wire it into your route
To use the request schema, pass it as the `body` option on an Elysia route:

```ts
.post(
	"/",
	async ({ body }) => { /* body is typed as CreateProductDTO */ },
	{ body: CreateProductRequest },
)
```

Elysia validates the incoming JSON against the schema before the handler runs. Invalid payloads return a `400` with a detailed validation error.
:::
