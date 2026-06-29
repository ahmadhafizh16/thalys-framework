# make:factory

The `thalys:make:factory` command creates a new factory class for generating test and seed data. Factories use `@faker-js/faker` to produce realistic dummy data and extend `BaseFactory` for a consistent `make()` / `makeMany()` API.

## Signature

```bash
thalys:make:factory {container} {name} {--f|force}
```

## Arguments

| Argument | Description |
| --- | --- |
| `container` | The target container name (PascalCase, e.g. `Product`). |
| `name` | The entity name. The `Factory` suffix is appended automatically (e.g. `Product` → `ProductFactory`). |

## Options

| Option | Shortcut | Description |
| --- | --- |
| `--force` | `-f` | Overwrite the file if it already exists. |

## What it generates

Creates a single file:

```txt
src/Containers/<Container>/Factories/<Name>Factory.ts
```

The generated class extends `BaseFactory<Insert<Name>>` and implements a `definition()` method that returns the default fake data shape. The `BaseFactory` base class provides `this.faker` (a configured `@faker-js/faker` instance) and the `make()` / `makeMany()` methods.

::: tip Requires an existing schema file
The factory stub imports `Insert<Name>` from `<name>.schema.ts`. Run `thalys:make:model` or `thalys:make:container --crud` first to generate the schema.
:::

## Example usage

```bash
bun run command thalys:make:factory Product Product

bun run command thalys:make:factory User User --force
```

Output:

```bash
Created ProductFactory  factoryPath=src/Containers/Product/Factories/ProductFactory.ts
```

## Generated file example

```ts
// src/Containers/Product/Factories/ProductFactory.ts
import { BaseFactory } from "@ship/Factory/BaseFactory";
import type { InsertProduct } from "@containers/Product/Models/product.schema";

export class ProductFactory extends BaseFactory<InsertProduct> {
	definition(): InsertProduct {
		return {
			// TODO: define default fake data using this.faker
		};
	}
}
```

After generation, fill in the `definition()` method with faker calls:

```ts
definition(): InsertProduct {
	return {
		name: this.faker.commerce.productName(),
	};
}
```

::: tip Use factories in seeders and tests
Call `new ProductFactory().make()` to get a single object, or `.makeMany(50)` for a batch. Override individual fields by passing a partial to `make({ name: "Custom Name" })`. This keeps seed data and test fixtures DRY.
:::
