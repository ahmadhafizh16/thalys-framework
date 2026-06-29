# Events

Thalys includes a lightweight in-process event system for decoupling side effects from business logic. When a user registers, you might want to send a welcome email, update analytics, and sync to a CRM — none of which should block the HTTP response. The event system lets you dispatch a single event and have multiple listeners handle it in parallel, with errors isolated so one failing listener doesn't break the others.

## How it works under the hood

The `EventDispatcher` maintains a `Map<channel, listener[]>`. When you dispatch an event, it looks up all listeners registered for that event's channel and runs them in parallel via `Promise.allSettled`. If a listener throws, the error is logged and swallowed — the other listeners still run, and the dispatch call itself never rejects.

```txt
Action
  │
  │  container.make("eventDispatcher").dispatch(new UserRegisteredEvent(userId, email))
  │
  ▼
EventDispatcher
  │  listeners.get("user.registered")  →  [SendWelcomeEmailListener, UpdateAnalyticsListener]
  │
  ▼
Promise.allSettled([listener.handle(event), listener.handle(event), ...])
  │
  ├─ fulfilled → done
  └─ rejected  → console.error, swallow (don't reject the dispatch)
```

## BaseEvent

Every event extends `BaseEvent`. The event's own properties are the payload — there is no separate wrapper object. Each event declares a `channel` string that listeners subscribe to, and inherits a `timestamp`.

```ts
// src/Ship/Events/BaseEvent.ts
export abstract class BaseEvent {
	abstract readonly channel: string;
	readonly timestamp: number = Date.now();
}
```

A concrete event:

```ts
class UserRegisteredEvent extends BaseEvent {
	readonly channel = "user.registered";

	constructor(
		public readonly userId: string,
		public readonly email: string,
	) {
		super();
	}
}
```

## The EventListener interface

Listeners implement `EventListener` — they declare which channel they listen to and provide a `handle()` method:

```ts
// src/Ship/Events/EventDispatcher.ts
export interface EventListener<E extends BaseEvent = BaseEvent> {
	readonly channel: string;
	handle(event: E): Promise<void> | void;
}
```

```ts
class SendWelcomeEmailListener implements EventListener<UserRegisteredEvent> {
	readonly channel = "user.registered";

	async handle(event: UserRegisteredEvent): Promise<void> {
		await emailService.send(event.email, "Welcome!", "...");
	}
}
```

## Creating events

Use the generator to create an event class in a container:

```bash
bun run command thalys:make:event User Registered
```

This generates `src/Containers/User/Events/UserRegisteredEvent.ts` with the channel set to `user.registered` (container name + event name, both kebab-cased, joined by a dot):

```ts
// Generated: src/Containers/User/Events/UserRegisteredEvent.ts
import { BaseEvent } from "@ship/Events/BaseEvent";

export class UserRegisteredEvent extends BaseEvent {
	readonly channel = "user.registered";

	constructor(
		public readonly userId: string,
		public readonly email: string,
	) {
		super();
	}
}
```

## Creating listeners

```bash
bun run command thalys:make:listener User SendWelcomeEmail
```

This generates `src/Containers/User/Listeners/SendWelcomeEmailListener.ts` and **auto-registers** it in `registerServices.ts`.

The generated listener:

```ts
// Generated: src/Containers/User/Listeners/SendWelcomeEmailListener.ts
import type { EventListener } from "@ship/Events/EventDispatcher";

export class SendWelcomeEmailListener implements EventListener {
	readonly channel = "user.send-welcome-email";

	async handle(event: any): Promise<void> {
		// TODO: implement
	}
}
```

::: warning Match the channel
The generator derives the channel from the listener name (`user.send-welcome-email`), not from the event. After generating, update the `channel` to match your event's channel (`user.registered`) and type the `handle` parameter:

```ts
import type { EventListener } from "@ship/Events/EventDispatcher";
import type { UserRegisteredEvent } from "@containers/User/Events/UserRegisteredEvent";

export class SendWelcomeEmailListener implements EventListener<UserRegisteredEvent> {
	readonly channel = "user.registered";  // match the event's channel

	async handle(event: UserRegisteredEvent): Promise<void> {
		await emailService.send(event.email, "Welcome to Thalys!");
	}
}
```
:::

## How listeners auto-register

The `MakeListenerCommand` patches `registerServices.ts` with two insertions:

```ts
// Import (inserted at [GENERATOR_IMPORTS]#123;[GENERATOR_IMPORTS]#123;GENERATOR_IMPORTS[GENERATOR_IMPORTS]#125;[GENERATOR_IMPORTS]#125;):
import { SendWelcomeEmailListener } from "@containers/User/Listeners/SendWelcomeEmailListener";

// Registration (inserted at [GENERATOR_LISTENERS]#123;[GENERATOR_LISTENERS]#123;GENERATOR_LISTENERS[GENERATOR_LISTENERS]#125;[GENERATOR_LISTENERS]#125;):
eventDispatcher.on(new SendWelcomeEmailListener());
```

The `EventDispatcher.on()` method registers the listener for its channel:

```ts
// src/Ship/Events/EventDispatcher.ts
on(listener: EventListener): void {
	const list = this.listeners.get(listener.channel);
	if (list) {
		list.push(listener);
	} else {
		this.listeners.set(listener.channel, [listener]);
	}
}
```

Multiple listeners can register for the same channel — they all fire when an event on that channel is dispatched.

## Dispatching events from Actions

Actions resolve the `EventDispatcher` from the container and call `dispatch()`:

```ts
// src/Containers/Auth/Actions/RegisterAction.ts
import type { EventDispatcher } from "@ship/Events/EventDispatcher";

export class RegisterAction extends BaseAction {
	constructor(
		db: AppDB,
		private readonly registerTask: RegisterTask,
		private readonly eventDispatcher: EventDispatcher,
	) {
		super(db);
	}

	async execute(input: RegisterInput) {
		const result = await this.registerTask.run(input);

		// Fire-and-forget side effects — listeners run in parallel
		await this.eventDispatcher.dispatch(
			new UserRegisteredEvent(result.session.userId, result.session.email),
		);

		return result;
	}
}
```

::: tip Dispatch is awaited but never throws
`dispatch()` is `async` — you should `await` it so listeners complete before the response is sent (important for transactional consistency). But even if a listener throws, `dispatch()` resolves normally. The error is logged to stderr. This means your Action never fails because of a side-effect failure.
:::

## Error isolation

The `dispatch()` method uses `Promise.allSettled()` to run all listeners in parallel. If any listener rejects, the rejection is caught and logged — it does not affect the other listeners or the dispatch call:

```ts
// src/Ship/Events/EventDispatcher.ts
async dispatch(event: BaseEvent): Promise<void> {
	const list = this.listeners.get(event.channel);
	if (!list || list.length === 0) return;

	const results = await Promise.allSettled(
		list.map(async (l) => l.handle(event)),
	);

	for (let i = 0; i < results.length; i++) {
		const result = results[i];
		if (result && result.status === "rejected") {
			console.error(
				`[EventDispatcher] Listener for "${event.channel}" threw:`,
				result.reason,
			);
		}
	}
}
```

::: warning Why console.error, not the logger?
The EventDispatcher is wired before the Pino logger is fully available (it's created in `createContainer` alongside the logger). Using `console.error` ensures the error is always visible regardless of initialisation order. In production, you'd typically replace this with `container.make("ErrorReporter").capture(...)`.
:::

## Explicit registration vs auto-discovery

You might wonder why Thalys uses explicit `eventDispatcher.on(new Listener())` calls instead of auto-discovering listener classes via file system scanning.

The answer is **Bun's bundled output**. In production, Thalys may be bundled into a single file (or a small set of chunks). File-system scanning relies on the source tree being present at runtime, which is not guaranteed after bundling. Explicit registration in `registerServices.ts` ensures every listener is reachable from the module graph — the bundler can trace the imports and include them in the output.

Auto-discovery also has a hidden cost: it makes the set of active listeners implicit. With explicit registration, you can see exactly which listeners are active by reading `registerServices.ts`. This is the same trade-off Laravel makes with its explicit service provider registration.

## Testing events

The `EventDispatcher` has a `clear()` method for test isolation:

```ts
import { describe, it, expect, beforeEach } from "bun:test";
import { EventDispatcher } from "@ship/Events/EventDispatcher";
import { BaseEvent } from "@ship/Events/BaseEvent";

class TestEvent extends BaseEvent {
	readonly channel = "test.event";
	constructor(public readonly value: string) {
		super();
	}
}

describe("EventDispatcher", () => {
	let dispatcher: EventDispatcher;

	beforeEach(() => {
		dispatcher = new EventDispatcher();
	});

	it("calls all listeners for a channel", async () => {
		const calls: string[] = [];
		dispatcher.on({
			channel: "test.event",
			handle: (e) => { calls.push((e as TestEvent).value); },
		});

		await dispatcher.dispatch(new TestEvent("hello"));

		expect(calls).toEqual(["hello"]);
	});

	it("does not block other listeners when one throws", async () => {
		const calls: string[] = [];

		dispatcher.on({
			channel: "test.event",
			handle: () => { throw new Error("boom"); },
		});
		dispatcher.on({
			channel: "test.event",
			handle: (e) => { calls.push((e as TestEvent).value); },
		});

		await dispatcher.dispatch(new TestEvent("survived"));

		expect(calls).toEqual(["survived"]);
	});

	it("does nothing for unregistered channels", async () => {
		await dispatcher.dispatch(new TestEvent("no listeners"));
		// no throw, no side effects
	});
});
```

## Extension: RedisEventDispatcher

The in-process dispatcher only works within a single process. For multi-process or multi-instance setups (e.g. separate queue workers, horizontal scaling), you need a dispatcher that publishes events over Redis pub/sub.

Implement the same `dispatch` interface, but publish to a Redis channel instead of calling listeners locally:

```ts
import Redis from "ioredis";
import type { BaseEvent } from "@ship/Events/BaseEvent";

export class RedisEventDispatcher {
	private readonly publisher: Redis;

	constructor(redisUrl: string) {
		this.publisher = new Redis(redisUrl);
	}

	async dispatch(event: BaseEvent): Promise<void> {
		await this.publisher.publish(
			`events:${event.channel}`,
			JSON.stringify(event),
		);
	}
}
```

Each process subscribes to the channels it cares about and runs its local listeners when a message arrives. The key insight: the `dispatch()` interface stays the same, so Actions don't change — only the container binding:

```ts
// In registerServices.ts:
const eventDispatcher = process.env.REDIS_URL
	? new RedisEventDispatcher(process.env.REDIS_URL)
	: new EventDispatcher();
container.set("eventDispatcher", eventDispatcher);
```
