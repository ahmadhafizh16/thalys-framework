# db:truncate

The `db:truncate` command truncates one or more application tables. It is a destructive operation designed for resetting development or staging databases — it requires an explicit `--force` flag and only allows tables on a hardcoded allowlist.

## Signature

```bash
db:truncate {tables*} {--force}
```

## Arguments

| Argument | Description |
| --- | --- |
| `tables` | One or more table names to truncate (variadic — pass multiple separated by spaces). Only tables on the allowlist are accepted. |

## Options

| Option | Shortcut | Description |
| --- | --- | --- |
| `--force` | | Required. Confirms the destructive truncate operation. The command refuses to run without this flag. |

## Allowed tables

Only the following tables can be truncated:

| Table | Description |
| --- | --- |
| `users` | User accounts |
| `roles` | RBAC roles |
| `role_permissions` | Role-permission mappings |

::: warning Destructive and irreversible
`TRUNCATE TABLE ... RESTART IDENTITY CASCADE` removes all rows, resets identity sequences, and cascades to dependent tables. There is no undo. Always verify the table name and environment before running.
:::

## Example usage

```bash
# Truncate a single table
bun run command db:truncate users --force

# Truncate multiple tables
bun run command db:truncate users roles role_permissions --force
```

Output:

```bash
Tables truncated  tables=["users"]
```

::: tip Extend the allowlist
The allowed tables are defined as a `Set` in `src/Ship/Console/Command/TruncateTableCommand.ts`. Add your table name to the `ALLOWED_TABLES` set if you need to truncate additional tables. This allowlist exists to prevent accidental truncation of critical tables like `migrations` or audit logs.
:::

::: tip Use after reseeding
A common workflow is to truncate and reseed:

```bash
bun run command db:truncate users roles role_permissions --force
bun run command db:seed:roles
bun run command db:seed:users --count 50
```

This gives you a clean slate with fresh test data.
:::
