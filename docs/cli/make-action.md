# make:action

The `thalys:make:action` command creates a new Action class — the transactional orchestration layer in Porto. Actions open `db.transaction(...)`, orchestrate Tasks, and map results through Transformers.

## Signature

```bash
thalys:make:action {container} {name} {--f|force}
```

## Arguments

| Argument | Description |
| --- | --- |
| `container` | The target container name (PascalCase, e.g. `Product`). |
| `name` | The action name. The `Action` suffix is appended automatically (e.g. `Publish` → `PublishAction`). |

## Options

| Option | Shortcut | Description |
| --- | --- | --- |
| `--force` | `-f` | Overwrite the file if it already exists. |

## What it generates

Creates a single file:

```txt
src/Containers/<Container>/Actions/<Name>Action.ts
```

The generated class extends `BaseAction`, receives an `AppDB` by constructor injection, and includes a stub `execute()` method.

### Auto-registration

The command inserts an import and a DI binding into `src/Ship/Container/registerServices.ts`:

- Import line above `// [GENERATOR_IMPORTS]#123;[GENERATOR_IMPORTS]#123;GENERATOR_IMPORTS[GENERATOR_IMPORTS]#125;[GENERATOR_IMPORTS]#125;`
- `container.bind(<Name>Action, "db")` above `// [GENERATOR_BINDINGS]#123;[GENERATOR_BINDINGS]#123;GENERATOR_BINDINGS[GENERATOR_BINDINGS]#125;[GENERATOR_BINDINGS]#125;`

The `"db"` string tells the DI container to inject the database connection when resolving the action.

## Example usage

```bash
bun run command thalys:make:action Product Publish

bun run command thalys:make:action Order Refund --force
```

Output:

```bash
Created PublishAction  path=src/Containers/Product/Actions/PublishAction.ts  registered=true
```

## Generated file example

```ts
// src/Containers/Product/Actions/PublishAction.ts
import type { AppDB } from "@ship/database/connection";
import { BaseAction } from "@ship/Actions/BaseAction";

export class PublishAction extends BaseAction {
	constructor(db: AppDB) {
		super(db);
	}

	async execute(): Promise<void> {
		// TODO: implement
	}
}
```

::: tip Actions are the transaction boundary
Actions are the only Porto layer that calls `db.transaction(...)`. Routes, Tasks, and Transformers never open transactions directly. This makes it trivial to audit transactional boundaries — grep for `.transaction(` and you see every Action.
:::

::: tip Add repository dependencies manually
The stub injects only `db`. If your action needs a repository, add it as a second constructor parameter and update the DI binding in `registerServices.ts` to pass the repository class as a third argument to `container.bind()`.
:::
