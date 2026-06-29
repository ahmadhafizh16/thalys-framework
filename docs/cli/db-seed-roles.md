# db:seed:roles

The `db:seed:roles` command seeds the default RBAC roles and their permissions into the database. It is idempotent — running it multiple times will not create duplicate roles or permissions.

## Signature

```bash
db:seed:roles
```

## Arguments

This command takes no arguments.

## Options

This command takes no options.

## What it does

The command opens a database transaction and seeds three default roles with their permission sets:

| Role | Description | Permissions |
| --- | --- | --- |
| `admin` | Full administrative access. | `*:*` (all resources, all actions) |
| `customer` | Default shopper account. | `profile:read`, `profile:update`, `order:read` |
| `seller` | Merchant account that manages catalog and orders. | `product:create`, `product:read`, `product:update`, `order:read`, `order:update` |

For each role, the command:

1. Checks if the role already exists by name. If so, reuses the existing row.
2. Checks if the role already has permissions. If not, inserts them.
3. Commits the transaction.

## Example usage

```bash
bun run command db:seed:roles
```

Output:

```bash
Roles seeded  roles=3  permissions=9
```

::: tip Run before db:seed:users
`db:seed:users` assigns roles to seeded users. If no roles exist, it will fail with an error telling you to run `db:seed:roles` first. Always seed roles before seeding users.
:::

::: tip Idempotent and safe
The seed command is safe to run multiple times. It checks for existing roles and permissions before inserting, so re-running after adding new permissions to the code will only insert the ones that are missing. However, it does **not** remove permissions that have been deleted from the code — clean up manually if needed.
:::

::: tip Customize roles and permissions
The default roles and permissions are defined as constants in `src/Containers/Auth/UI/Command/SeedRolesCommand.ts`. Edit the `DEFAULT_ROLES` and `DEFAULT_PERMISSIONS` arrays to match your application's RBAC model, then re-run the command.
:::
