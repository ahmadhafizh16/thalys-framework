import { describe, expect, it, mock } from "bun:test";
import { BaseEvent } from "@ship/Events/BaseEvent";
import { EventDispatcher } from "@ship/Events/EventDispatcher";
import type { EventListener } from "@ship/Events/EventDispatcher";

class TestEvent extends BaseEvent {
	readonly channel = "test.event";
	constructor(public readonly message: string) {
		super();
	}
}

class OtherEvent extends BaseEvent {
	readonly channel = "other.event";
}

function createListener(channel: string): {
	listener: EventListener;
	handle: ReturnType<typeof mock>;
} {
	const handle = mock(() => {});
	const listener: EventListener = { channel, handle };
	return { listener, handle };
}

describe("BaseEvent", () => {
	it("sets a timestamp on construction", () => {
		const before = Date.now();
		const event = new TestEvent("hello");
		const after = Date.now();
		expect(event.timestamp).toBeGreaterThanOrEqual(before);
		expect(event.timestamp).toBeLessThanOrEqual(after);
	});

	it("exposes the channel property", () => {
		const event = new TestEvent("hello");
		expect(event.channel).toBe("test.event");
	});
});

describe("EventDispatcher", () => {
	it("dispatches an event to a registered listener", async () => {
		const dispatcher = new EventDispatcher();
		const { listener, handle } = createListener("test.event");
		dispatcher.on(listener);

		const event = new TestEvent("hello");
		await dispatcher.dispatch(event);

		expect(handle).toHaveBeenCalledTimes(1);
		expect(handle).toHaveBeenCalledWith(event);
	});

	it("passes the correct event instance to the listener", async () => {
		const dispatcher = new EventDispatcher();
		const { listener, handle } = createListener("test.event");
		dispatcher.on(listener);

		const event = new TestEvent("payload");
		await dispatcher.dispatch(event);

		expect(handle.mock.calls[0]![0]).toBe(event);
		expect((handle.mock.calls[0]![0] as TestEvent).message).toBe("payload");
	});

	it("calls multiple listeners on the same channel", async () => {
		const dispatcher = new EventDispatcher();
		const { listener: l1, handle: h1 } = createListener("test.event");
		const { listener: l2, handle: h2 } = createListener("test.event");
		dispatcher.on(l1);
		dispatcher.on(l2);

		await dispatcher.dispatch(new TestEvent("hello"));

		expect(h1).toHaveBeenCalledTimes(1);
		expect(h2).toHaveBeenCalledTimes(1);
	});

	it("does not call listeners on other channels", async () => {
		const dispatcher = new EventDispatcher();
		const { listener, handle } = createListener("other.event");
		dispatcher.on(listener);

		await dispatcher.dispatch(new TestEvent("hello"));

		expect(handle).not.toHaveBeenCalled();
	});

	it("does nothing when no listeners are registered for the channel", async () => {
		const dispatcher = new EventDispatcher();
		await expect(dispatcher.dispatch(new TestEvent("hello"))).resolves.toBeUndefined();
	});

	it("awaits async listeners", async () => {
		const dispatcher = new EventDispatcher();
		let resolved = false;
		dispatcher.on({
			channel: "test.event",
			async handle() {
				await new Promise((r) => setTimeout(r, 10));
				resolved = true;
			},
		});

		await dispatcher.dispatch(new TestEvent("hello"));
		expect(resolved).toBe(true);
	});

	it("continues if one listener throws", async () => {
		const dispatcher = new EventDispatcher();
		const { listener: good, handle: goodHandle } = createListener("test.event");
		dispatcher.on({
			channel: "test.event",
			handle() {
				throw new Error("boom");
			},
		});
		dispatcher.on(good);

		await dispatcher.dispatch(new TestEvent("hello"));

		expect(goodHandle).toHaveBeenCalledTimes(1);
	});

	it("clears listeners for a specific channel", async () => {
		const dispatcher = new EventDispatcher();
		const { listener, handle } = createListener("test.event");
		dispatcher.on(listener);

		dispatcher.clear("test.event");
		await dispatcher.dispatch(new TestEvent("hello"));

		expect(handle).not.toHaveBeenCalled();
	});

	it("clears all listeners when no channel given", async () => {
		const dispatcher = new EventDispatcher();
		const { listener: l1, handle: h1 } = createListener("test.event");
		const { listener: l2, handle: h2 } = createListener("other.event");
		dispatcher.on(l1);
		dispatcher.on(l2);

		dispatcher.clear();
		await dispatcher.dispatch(new TestEvent("hello"));
		await dispatcher.dispatch(new OtherEvent());

		expect(h1).not.toHaveBeenCalled();
		expect(h2).not.toHaveBeenCalled();
	});
});
