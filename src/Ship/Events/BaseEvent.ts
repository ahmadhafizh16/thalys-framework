/**
 * Base class for typed events.
 *
 * Each event declares a `channel` string that listeners subscribe to.
 * The payload is the event's own properties — no separate wrapper.
 *
 * @example
 * class UserRegisteredEvent extends BaseEvent {
 *   readonly channel = "user.registered";
 *   constructor(
 *     public readonly userId: string,
 *     public readonly email: string,
 *   ) { super(); }
 * }
 */
export abstract class BaseEvent {
	abstract readonly channel: string;
	readonly timestamp: number = Date.now();
}
