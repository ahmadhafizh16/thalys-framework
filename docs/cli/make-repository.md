# make:repository

The `thalys:make:repository` command creates a new Repository class that extends `BaseRepository`. Repositories encapsulate data access — they provide CRUD, filtering, sorting, and cursor-based pagination out of the box.

## Signature

```bash
thalys:make:repository {container} {name} {--f|force}
```

## Arguments

| Argument | Description |
| --- | --- |
| `container` | The target container name (PascalCase, e.g. `Product`). |
| `name` | The entity name. The `Repository` suffix is appended automatically (e.g. `Product` → `ProductRepository`). |

## Options

| Option | Shortcut | Description |
| --- | --- | --- |
| `--force` | `-f` | Overwrite the file if it already exists. |

## What it generates

Creates a single file:

```txt
src/Containers/<Container>/Models/<Name>Repository.ts
```

The generated class extends `BaseRepository<typeof <name>sTable>`, accepting an `AppClient` (the pool or a transaction) in its constructor and passing it to `super()` along with the Drizzle table instance.

::: tip Requires an existing schema file
The repository stub imports the Drizzle table from `<name>.schema.ts`. If the schema file does not exist yet, run `thalys:make:model` first (which generates both the schema and a repository), or `thalys:make:container --crud` (which generates the entire stack).
:::

### Auto-registration

The command inserts an import and a DI binding into `src/Ship/Container/registerServices.ts`:

- Import line above `// [GENERATOR_IMPORTS]#123;[GENERATOR_IMPORTS]#123;GENERATOR_IMPORTS[GENERATOR_IMPORTS]#125;[GENERATOR_IMPORTS]#125;`
- `container.bind(<Name>Repository, "db")` above `// [GENERATOR_BINDINGS]#123;[GENERATOR_BINDINGS]#123;GENERATOR_BINDINGS[GENERATOR_BINDINGS]#125;[GENERATOR_BINDINGS]#125;`

## Example usage

```bash
bun run command thalys:make:repository Product Product

bun run command thalys:make:repository Order Order --force
```

Output:

```bash
Created ProductRepository  path=src/Containers/Product/Models/ProductRepository.ts  registered=true
```

## Generated file example

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

That is the entire file — and it already gives you `findById`, `findOne`, `findMany`, `create`, `update`, `delete`, and `paginate` inherited from `BaseRepository`.

::: tip AppClient = AppDB | AppTx
The repository accepts `AppClient`, which is the union of the pooled connection and a transaction. This is why Actions call `repo.withTransaction(tx)` to get a transaction-scoped copy — the same repository class works in both contexts.
:::

::: tip Add domain-specific queries
To add a query that `BaseRepository` does not provide, just add a method to the concrete class. For example, `UserRepository` adds `assertEmailAvailable(email)` which calls `findOne()` and throws `ConflictError` if the email exists.
:::
