# db:migrate

The `db:migrate` command applies pending database migrations to your Postgres database. It wraps `drizzle-kit migrate`, executing every unapplied `.sql` file in the `drizzle/` directory.

## Signature

```bash
db:migrate
```

## Arguments

This command takes no arguments.

## Options

This command takes no options.

## What it does

1. Reads the migration journal from `drizzle/meta/_journal.json`.
2. Compares the journal against `.sql` files on disk in `drizzle/`.
3. Executes every pending migration file against the database configured in `APP_DATABASE_URL`.
4. Updates the journal to mark each migration as applied.

## Example usage

```bash
bun run command db:migrate
```

This connects to `APP_DATABASE_URL` (Postgres on `localhost:30001` over the SSH tunnel in local dev) and runs all unapplied migrations.

::: warning Tunnel must be up
`db:migrate` connects to `APP_DATABASE_URL` (i.e. `localhost:30001` over the SSH tunnel in local dev). If the tunnel is down, the migration fails with a connection error. Verify the tunnel before running migrations.
:::

::: tip Check status first
Run `db:status` before `db:migrate` to see which migrations are pending. This avoids surprises — you will know exactly which SQL files will execute.
:::

::: tip Migrations are transactional
Drizzle Kit wraps each migration in a transaction. If a migration fails partway through, the entire migration is rolled back and the journal is not updated — you can fix the issue and re-run `db:migrate` without partial state.
:::
