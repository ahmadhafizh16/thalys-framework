# db:generate

The `db:generate` command generates a new SQL migration from your Drizzle schema changes. It wraps `drizzle-kit generate`, diffing your `*.schema.ts` files against the last migration snapshot and producing a new `.sql` file.

## Signature

```bash
db:generate {name?}
```

## Arguments

| Argument | Description |
| --- | --- |
| `name` | Optional migration name. Appended to the migration filename (e.g. `db:generate add_products_sku` → `0002_add_products_sku.sql`). |

## What it does

1. Scans all `src/Containers/**/Models/*.schema.ts` files for `pgTable` definitions.
2. Diffs the current schema against the last migration snapshot stored in `drizzle/meta/`.
3. Generates a new `.sql` file in `drizzle/` containing the `CREATE TABLE`, `ALTER TABLE`, or `DROP` statements.
4. Updates the `_journal.json` migration log in `drizzle/meta/`.

## Example usage

```bash
# Generate with no name (auto-numbered)
bun run command db:generate

# Generate with a descriptive name
bun run command db:generate add_products_sku
```

Output:

```bash
[*] Reading drizzle config...
[*] Pulling schema from database...
[*] Generating migrations...
[*] You have 1 new migration:
    → 0001_create_products_table.sql
```

## Generated migration example

```sql
-- drizzle/0001_create_products_table.sql
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

::: tip Review before applying
Always review the generated SQL before running `db:migrate`. Drizzle generates correct but sometimes verbose migrations — for example, changing a column type may produce a `DROP` + `ADD` instead of an `ALTER`. If the migration looks wrong, delete the `.sql` file, fix your schema, and re-run `db:generate`.
:::
