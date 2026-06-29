# make:model

The `thalys:make:model` command creates a new Drizzle schema file and its companion repository. The schema is the single source of truth for types — every downstream layer (repository, actions, transformer) infers its types from the `pgTable` definition.

## Signature

```bash
thalys:make:model {container} {name} {--f|force}
```

## Arguments

| Argument | Description |
| --- | --- |
| `container` | The target container name (PascalCase, e.g. `Product`). |
| `name` | The entity name. Used to derive the table variable name, DB table name, and file name. |

## Options

| Option | Shortcut | Description |
| --- | --- |
| `--force` | `-f` | Overwrite existing files if they already exist. |

## What it generates

Creates **two files**:

```txt
src/Containers/<Container>/Models/
├── <name>.schema.ts          # Drizzle pgTable + Raw/Insert types
└── <Name>Repository.ts       # extends BaseRepository<typeof <name>sTable>
```

### Schema file

The schema stub generates a `pgTable` with:

- **`id`** — `text` primary key with `$defaultFn(() => uuidv7())` for time-ordered UUIDv7 IDs.
- **`name`** — a `text` column as a placeholder for your first domain field.
- **`createdAt`** — `timestamp` with `defaultNow()`, not null.
- **`updatedAt`** — `timestamp` with `defaultNow()`, not null.

Two types are exported: `Raw<Name>` (the row shape) and `Insert<Name>` (the insert shape).

### Repository file

The repository extends `BaseRepository<typeof <name>sTable>` and accepts an `AppClient` in its constructor.

::: tip Naming conventions
The table variable uses camelCase + `Table` suffix (e.g. `productsTable`). The DB table name uses snake_case plural (e.g. `products`). The schema file uses kebab-case (e.g. `product.schema.ts`). Drizzle Kit only scans `*.schema.ts` files for migration generation.
:::

## Example usage

```bash
bun run command thalys:make:model Product Product

bun run command thalys:make:model Order LineItem --force
```

Output:

```bash
Created Product schema + repository  schemaPath=src/Containers/Product/Models/product.schema.ts  repoPath=src/Containers/Product/Models/ProductRepository.ts
```

## Generated file examples

### Schema

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

export type RawProduct = typeof productsTable.$inferSelect;
export type InsertProduct = typeof productsTable.$inferInsert;
```

### Repository

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

::: tip Why UUIDv7?
UUIDv7 is time-ordered, so B-tree index inserts are sequential rather than random. This avoids index fragmentation at scale — a known problem with UUIDv4. The PK is `text` (not Postgres `uuid`) because the `uuidv7` package returns a string and `$defaultFn` generates it in JavaScript at insert time.
:::

::: tip Customize before migrating
The stub generates a minimal `name` column. Add your real columns (e.g. `sku`, `priceCents`, `inStock`) to the `pgTable` before running `db:generate` — the `Raw` and `Insert` types update automatically, and every downstream file picks up the new columns through the type system.
:::

::: tip Register the repository manually
Unlike `thalys:make:repository`, the `make:model` command does **not** auto-register the repository in `registerServices.ts`. Add the import and `container.bind()` call manually, or run `thalys:make:repository` separately.
:::
