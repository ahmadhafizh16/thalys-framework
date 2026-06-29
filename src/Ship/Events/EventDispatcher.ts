import type { BaseEvent } from "./BaseEvent";

/**
 * Listener interface — listeners register for a channel and receive the event.
 * Async handlers are supported; dispatch() awaits all listeners.
 */
export interface EventListener<E extends BaseEvent = BaseEvent> {
	readonly channel: string;
	handle(event: E): Promise<void> | void;
}

/**
 * In-process event dispatcher.
 *
 * Maintains a Map<channel, listener[]>. dispatch() calls all listeners
 * for the event's channel and awaits them. Errors in one listener do
 * not prevent others from running — they're logged and swallowed.
 *
 * For multi-process setups, implement the same interface with Redis pub/sub.
 */
export class EventDispatcher {
	private readonly listeners = new Map<string, EventListener[]>();

	/**
	 * Register a listener for a channel.
	 * Multiple listeners per channel are supported.
	 */
	on(listener: EventListener): void {
		const list = this.listeners.get(listener.channel);
		if (list) {
			list.push(listener);
		} else {
			this.listeners.set(listener.channel, [listener]);
		}
	}

	/**
	 * Dispatch an event to all registered listeners on its channel.
	 * Listeners run in parallel. Errors are caught and logged — one
	 * failing listener does not prevent others from running.
	 */
	async dispatch(event: BaseEvent): Promise<void> {
		const list = this.listeners.get(event.channel);
		if (!list || list.length === 0) return;

		const results = await Promise.allSettled(list.map(async (l) => l.handle(event)));

		for (let i = 0; i < results.length; i++) {
			const result = results[i];
			if (result && result.status === "rejected") {
				console.error(`[EventDispatcher] Listener for "${event.channel}" threw:`, result.reason);
			}
		}
	}

	/**
	 * Remove all listeners for a channel (or all channels if no channel given).
	 * Primarily for tests.
	 */
	clear(channel?: string): void {
		if (channel) {
			this.listeners.delete(channel);
		} else {
			this.listeners.clear();
		}
	}
}
