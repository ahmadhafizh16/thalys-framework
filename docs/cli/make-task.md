# make:task

The `thalys:make:task` command creates a new Task class — the single-responsibility layer in Porto that performs exactly one database or system operation. A Task never calls another Task or an Action.

## Signature

```bash
thalys:make:task {container} {name} {--pure} {--f|force}
```

## Arguments

| Argument | Description |
| --- | --- |
| `container` | The target container name (PascalCase, e.g. `Product`). |
| `name` | The task name. The `Task` suffix is appended automatically (e.g. `HashPassword` → `HashPasswordTask`). |

## Options

| Option | Shortcut | Description |
| --- | --- | --- |
| `--pure` | | Generate a DB-free task — no `AppClient` dependency, no `BaseTask` extension. Use for tasks that do not touch the database (e.g. sending an email, transforming a file). |
| `--force` | `-f` | Overwrite the file if it already exists. |

## What it generates

Creates a single file:

```txt
src/Containers/<Container>/Tasks/<Name>Task.ts
```

### Auto-registration

The command inserts an import and a DI binding into `src/Ship/Container/registerServices.ts`:

- **Without `--pure`:** `container.bind(<Name>Task, "db")` — the `"db"` dependency is injected.
- **With `--pure`:** `container.bind(<Name>Task)` — no `"db"` in the bind, since the task has no database dependency.

## Example usage

```bash
# DB-backed task
bun run command thalys:make:task User HashPassword

# Pure task (no DB dependency)
bun run command thalys:make:task Notification SendWelcomeEmail --pure

# Overwrite
bun run command thalys:make:task User HashPassword --force
```

Output:

```bash
Created HashPasswordTask  path=src/Containers/User/Tasks/HashPasswordTask.ts  registered=true
```

## Generated file examples

### Standard task (with DB)

```ts
// src/Containers/User/Tasks/HashPasswordTask.ts
import type { AppClient } from "@ship/database/connection";
import { BaseTask } from "@ship/Tasks/BaseTask";

export class HashPasswordTask extends BaseTask {
	constructor(dbClient: AppClient) {
		super(dbClient);
	}

	async run(): Promise<void> {
		// TODO: implement
	}
}
```

### Pure task (no DB)

```ts
// src/Containers/Notification/Tasks/SendWelcomeEmailTask.ts
export class SendWelcomeEmailTask {
	async run(): Promise<void> {
		// TODO: implement
	}
}
```

::: tip When to use --pure
Use `--pure` for tasks that perform I/O unrelated to your Postgres database — sending emails, pushing to a queue, calling an external API, or transforming in-memory data. The pure stub has zero framework imports, making it trivially testable.
:::

::: tip One operation per task
A Task should do exactly one thing. If you find yourself adding multiple unrelated queries to a single Task, split it into multiple Tasks and orchestrate them from an Action.
:::
