# make:transformer

The `thalys:make:transformer` command creates a new Transformer class that maps a raw database row to a safe, client-facing output shape. Transformers are the last layer before the HTTP response — they ensure internal columns never leak to the API.

## Signature

```bash
thalys:make:transformer {container} {name} {--f|force}
```

## Arguments

| Argument | Description |
| --- | --- |
| `container` | The target container name (PascalCase, e.g. `Product`). |
| `name` | The entity name. The `Transformer` suffix is appended automatically (e.g. `Product` → `ProductTransformer`). |

## Options

| Option | Shortcut | Description |
| --- | --- |
| `--force` | `-f` | Overwrite the file if it already exists. |

## What it generates

Creates a single file:

```txt
src/Containers/<Container>/Transformers/<Name>Transformer.ts
```

The generated class extends `BaseTransformer<Raw<Name>, Safe<Name>Output>` and implements a `transform()` method. It also exports a `Safe<Name>Output` interface defining the response shape.

::: tip Requires an existing schema file
The transformer stub imports `Raw<Name>` from `<name>.schema.ts`. If the schema file does not exist yet, run `thalys:make:model` or `thalys:make:container --crud` first.
:::

## Example usage

```bash
bun run command thalys:make:transformer Product Product

bun run command thalys:make:transformer Order Order --force
```

Output:

```bash
Created ProductTransformer  path=src/Containers/Product/Transformers/ProductTransformer.ts
```

## Generated file example

```ts
// src/Containers/Product/Transformers/ProductTransformer.ts
import type { RawProduct } from "@containers/Product/Models/product.schema";
import { BaseTransformer } from "@ship/Transformers/BaseTransformer";

export interface SafeProductOutput {
	id: string;
	name: string;
	createdOn: string;
}

export class ProductTransformer extends BaseTransformer<RawProduct, SafeProductOutput> {
	transform(entity: RawProduct): SafeProductOutput {
		return {
			id: entity.id,
			name: entity.name,
			createdOn: entity.createdAt.toISOString(),
		};
	}
}
```

::: tip The output interface is your API contract
The `Safe<Name>Output` interface is the explicit contract between your database and your API clients. Only fields listed in this interface are exposed. To add or remove a field from the response, edit the interface and the `transform()` method — the TypeScript compiler will flag every call site that needs updating.
:::

::: tip No database access in transformers
Transformers never touch the database. They are pure mapping functions. This makes them trivially testable and ensures the response shaping layer has no side effects.
:::
