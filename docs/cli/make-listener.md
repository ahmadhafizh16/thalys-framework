# make:listener

The `thalys:make:listener` command creates a new event listener class that implements the `EventListener` interface. Listeners subscribe to a channel and handle events dispatched by the `EventDispatcher`.

## Signature

```bash
thalys:make:listener {container} {name} {--f|force}
```

## Arguments

| Argument | Description |
| --- | --- |
| `container` | The target container name (PascalCase, e.g. `User`). |
| `name` | The listener name. The `Listener` suffix is appended automatically (e.g. `SendWelcomeEmail` → `SendWelcomeEmailListener`). |

## Options

| Option | Shortcut | Description |
| --- | --- |
| `--force` | `-f` | Overwrite the file if it already exists. |

## What it generates

Creates a single file:

```txt
src/Containers/<Container>/Listeners/<Name>Listener.ts
```

The generated class implements `EventListener` with a `channel` property and a `handle()` method. The channel is derived from the container and listener names in kebab-case, joined by a dot: `<container>.<name>` — this matches the channel naming convention used by `thalys:make:event`.

### Auto-registration

The command inserts an import and a registration line into `src/Ship/Container/registerServices.ts`:

- Import line above `// [GENERATOR_IMPORTS]#123;[GENERATOR_IMPORTS]#123;GENERATOR_IMPORTS[GENERATOR_IMPORTS]#125;[GENERATOR_IMPORTS]#125;`
- `eventDispatcher.on(new <Name>Listener())` above `// [GENERATOR_LISTENERS]#123;[GENERATOR_LISTENERS]#123;GENERATOR_LISTENERS[GENERATOR_LISTENERS]#125;[GENERATOR_LISTENERS]#125;`

This marker is distinct from the `// [GENERATOR_BINDINGS]#123;[GENERATOR_BINDINGS]#123;GENERATOR_BINDINGS[GENERATOR_BINDINGS]#125;[GENERATOR_BINDINGS]#125;` marker used by Actions, Tasks, and Repositories — listeners are registered with the `EventDispatcher`, not the DI container's `bind()` method.

## Example usage

```bash
bun run command thalys:make:listener User SendWelcomeEmail

bun run command thalys:make:listener Order GenerateInvoice --force
```

Output:

```bash
Created SendWelcomeEmailListener  path=src/Containers/User/Listeners/SendWelcomeEmailListener.ts  registered=true
```

## Generated file example

```ts
// src/Containers/User/Listeners/SendWelcomeEmailListener.ts
import type { BaseEvent } from "@ship/Events/BaseEvent";
import type { EventListener } from "@ship/Events/EventDispatcher";

export class SendWelcomeEmailListener implements EventListener {
	readonly channel = "user.send-welcome-email";

	async handle(_event: BaseEvent): Promise<void> {
		// TODO: implement
	}
}
```

::: tip Match the channel to an event
The listener's `channel` must match the event's `channel` for the listener to receive it. Both `make:event` and `make:listener` derive the channel from the same `<container>.<name>` pattern, so if you create a `Registered` event in the `User` container and a `Registered` listener in the same container, their channels will match automatically (`user.registered`).
:::

::: tip The GENERATOR_LISTENERS marker
Listener registration uses a dedicated `// [GENERATOR_LISTENERS]#123;[GENERATOR_LISTENERS]#123;GENERATOR_LISTENERS[GENERATOR_LISTENERS]#125;[GENERATOR_LISTENERS]#125;` marker in `registerServices.ts`, separate from the `// [GENERATOR_BINDINGS]#123;[GENERATOR_BINDINGS]#123;GENERATOR_BINDINGS[GENERATOR_BINDINGS]#125;[GENERATOR_BINDINGS]#125;` marker used by Actions and Tasks. Never delete this marker — future `thalys:make:listener` commands depend on it.
:::
