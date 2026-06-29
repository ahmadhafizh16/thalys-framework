# make:command

The `thalys:make:command` command creates a new class-based console command — the Artisan-style CLI entry point. Each command extends `ConsoleCommand`, declares a `signature` (Laravel-style argument/option syntax), and implements a `handle()` method.

## Signature

```bash
thalys:make:command {name} {--container=} {--f|force}
```

## Arguments

| Argument | Description |
| --- | --- |
| `name` | The command name. The `Command` suffix is appended automatically (e.g. `SendNewsletter` → `SendNewsletterCommand`). |

## Options

| Option | Shortcut | Description |
| --- | --- |
| `--container` | | Target container. When provided, the command is placed in `src/Containers/<Container>/UI/Command/`. When omitted, it is placed in `src/Ship/Console/Command/` and auto-registered. |
| `--force` | `-f` | Overwrite the file if it already exists. |

## What it generates

Creates a single file:

- **Without `--container`:** `src/Ship/Console/Command/<Name>Command.ts`
- **With `--container`:** `src/Containers/<Container>/UI/Command/<Name>Command.ts`

The generated class extends `ConsoleCommand`, includes a type alias for the parsed input, and declares `signature`, `description`, and `handle()`.

### Auto-registration (Ship commands only)

When `--container` is **not** provided, the command auto-registers itself in `src/Ship/Console/commands.ts`:

- Import line above `// [GENERATOR_IMPORTS]#123;[GENERATOR_IMPORTS]#123;GENERATOR_IMPORTS[GENERATOR_IMPORTS]#125;[GENERATOR_IMPORTS]#125;`
- `new <Name>Command(),` above `// [GENERATOR_COMMANDS]#123;[GENERATOR_COMMANDS]#123;GENERATOR_COMMANDS[GENERATOR_COMMANDS]#125;[GENERATOR_COMMANDS]#125;`

Container commands are **not** auto-registered — import and instantiate them manually in `commands.ts`.

### Signature derivation

The command's `signature` is derived from the name argument: kebab-case with hyphens replaced by colons. For example, `SendNewsletter` becomes `send:newsletter`. This follows the Thalys naming convention where command names use colon-separated namespaces.

## Example usage

```bash
# Ship command (auto-registered)
bun run command thalys:make:command SendNewsletter

# Container command (not auto-registered)
bun run command thalys:make:command ExportOrders --container=Order

# Overwrite
bun run command thalys:make:command SendNewsletter --force
```

Output:

```bash
Created SendNewsletterCommand  path=src/Ship/Console/Command/SendNewsletterCommand.ts
```

## Generated file example

```ts
// src/Ship/Console/Command/SendNewsletterCommand.ts
import { ConsoleCommand } from "@ship/Console/ConsoleCommand";
import type { ConsoleContext } from "@ship/Console/ConsoleContext";

type SendNewsletterCommandInput = Record<string, never>;

export class SendNewsletterCommand extends ConsoleCommand<SendNewsletterCommandInput> {
	readonly signature = "send:newsletter";
	readonly description = "Run the SendNewsletterCommand";

	async handle(_input: SendNewsletterCommandInput, context: ConsoleContext): Promise<void> {
		// TODO: implement
	}
}
```

::: tip Signature syntax
The `signature` property uses Laravel-style syntax for declaring arguments and options. Edit it to add your own:

```ts
readonly signature = "send:newsletter {--list : Send to a specific list}";
```

The framework's `parseCommandSignature()` parses this string at registration time, extracting arguments (required `{name}`, optional `{name?}`, variadic `{name*}`) and options (boolean `{--force}`, valued `{--count=}`, shortcut `{--c|count=}`).
:::

::: tip Use the context for DB and logging
The `ConsoleContext` parameter provides `context.db` (the database connection), `context.log` (the Pino logger), and `context.container` (the DI container for resolving services). Access services through the container rather than importing singletons:

```ts
const action = context.container.make(SendEmailAction);
await action.execute();
```
:::
