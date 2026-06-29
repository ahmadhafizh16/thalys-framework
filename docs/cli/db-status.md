# db:status

The `db:status` command shows the state of your database migrations — which have been applied and which are pending. It reads the Drizzle migration journal and compares it against the `.sql` files on disk.

## Signature

```bash
db:status
```

## Arguments

This command takes no arguments.

## Options

This command takes no options.

## What it does

1. Reads `drizzle/meta/_journal.json` — the migration journal that tracks applied migrations.
2. Scans the `drizzle/` directory for `.sql` files.
3. Compares the journal entries against the SQL files on disk.
4. Reports the total count, applied count, pending count, and per-file status.

::: tip No database connection required
`db:status` reads only local files — it does not connect to the database. The journal reflects what `drizzle-kit migrate` has applied. If the database is out of sync with the journal (e.g. someone manually ran SQL), `db:status` will not detect it.
:::

## Example usage

```bash
bun run command db:status
```

Output:

```bash
Migration status  total=3  applied=2  pending=1  migrations=[
  { file: "0000_initial.sql", status: "applied" },
  { file: "0001_create_products_table.sql", status: "applied" },
  { file: "0002_add_products_sku.sql", status: "pending" }
]
```

::: tip Run before db:migrate
Always run `db:status` before `db:migrate` to verify which migrations will execute. If the pending count is `0`, there is nothing to migrate and the database is up to date.
:::

::: tip No migrations yet?
If you see "No migrations found. Run 'db:generate' to create one." — it means `drizzle/meta/_journal.json` does not exist. Run `db:generate` first to create your initial migration from the schema files.
:::
