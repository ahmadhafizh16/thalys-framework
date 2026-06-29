# make:event

The `thalys:make:event` command creates a new event class for Thalys's in-process pub/sub system. Events are dispatched by the `EventDispatcher` and consumed by listeners that subscribe to a channel.

## Signature

```bash
thalys:make:event {container} {name} {--f|force}
```

## Arguments

| Argument | Description |
| --- | --- |
| `container` | The target container name (PascalCase, e.g. `User`). |
| `name` | The event name. The `Event` suffix is appended automatically (e.g. `Registered` → `RegisteredEvent`). |

## Options

| Option | Shortcut | Description |
| --- | --- |
| `--force` | `-f` | Overwrite the file if it already exists. |

## What it generates

Creates a single file:

```txt
src/Containers/<Container>/Events/<Name>Event.ts
```

The generated class extends `BaseEvent` and declares a `channel` property. The channel is derived from the container and event names in kebab-case, joined by a dot: `<container>.<name>` (e.g. `user.registered`).

## Example usage

```bash
bun run command thalys:make:event User Registered

bun run command thalys:make:event Order Shipped --force
```

Output:

```bash
Created RegisteredEvent  path=src/Containers/User/Events/RegisteredEvent.ts
```

## Generated file example

```ts
// src/Containers/User/Events/RegisteredEvent.ts
import { BaseEvent } from "@ship/Events/BaseEvent";

export class RegisteredEvent extends BaseEvent {
	readonly channel = "user.registered";
}
```

::: tip Channel naming convention
The channel is automatically derived as `<container-kebab>.<event-kebab>`. For `User` + `Registered`, the channel is `user.registered`. Listeners that subscribe to this channel will receive the event when it is dispatched. The channel is deterministic — you do not need to memorize it, just look at the generated file.
:::

::: tip Dispatch from Actions
Events are typically dispatched inside Actions after a transactional operation completes:

```ts
await this.db.transaction(async (tx) => {
	const user = await txRepo.create(payload);
	await eventDispatcher.dispatch(new RegisteredEvent(user));
	return user;
});
```

Create a matching listener with `thalys:make:listener` to handle the event.
:::
