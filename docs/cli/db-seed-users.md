# db:seed:users

The `db:seed:users` command seeds fake users with hashed passwords using `@faker-js/faker`. It creates realistic test data for development and staging environments.

## Signature

```bash
db:seed:users {--count=50} {--password=password123} {--role=}
```

## Arguments

This command takes no positional arguments.

## Options

| Option | Shortcut | Default | Description |
| --- | --- | --- | --- |
| `--count` | `-c` | `50` | Number of users to seed. Must be a positive integer. |
| `--password` | `-p` | `password123` | Plain-text password to hash for every seeded user. |
| `--role` | `-r` | _(random)_ | Specific role name to assign to every seeded user. When omitted, each user gets a randomly assigned role from the available roles. |

## What it does

1. Validates that the `count` is a positive integer.
2. Resolves available roles through the `RolesBridgePort` (cross-container bridge). If `--role` is provided, fetches only that role; otherwise fetches all.
3. For each user, generates fake data using Faker:
   - `name` — `faker.person.fullName()`
   - `email` — unique `@example.test` address (UUID-prefixed to avoid collisions)
   - `phone` — `faker.phone.number()`
   - `profilePic` — `faker.image.avatar()`
   - `password` — the `--password` value (hashed by `CreateUserAction`)
   - `roleId` — the specified role or a random pick
4. Calls `CreateUserAction.execute()` for each user — this hashes the password, opens a transaction, and inserts the row.

## Example usage

```bash
# Default: 50 users with random roles, password "password123"
bun run command db:seed:users

# 100 users with a specific password
bun run command db:seed:users --count 100 --password mySecretPass

# 10 users all assigned the "seller" role
bun run command db:seed:users --count 10 --role seller
```

Output:

```bash
Users seeded  inserted=50  roleMode=random
```

::: warning Requires roles to exist
The command fails if no roles are found. Run `db:seed:roles` first:

```bash
bun run command db:seed:roles
bun run command db:seed:users --count 50
```
:::

::: tip Unique emails
Each seeded user gets a UUID-prefixed email (e.g. `a1b2c3d4@example.test`) to guarantee uniqueness across multiple seed runs. This lets you re-run the seeder without hitting unique constraint violations.
:::

::: tip Uses CreateUserAction — not raw inserts
The seeder does not insert rows directly. It calls `CreateUserAction.execute()`, which means every seeded user goes through the full Action pipeline: password hashing, transaction, and repository insert. This ensures seeded data is identical to production-created data.
:::
