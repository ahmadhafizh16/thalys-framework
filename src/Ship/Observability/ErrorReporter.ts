/**
 * Error tracking integration point.
 *
 * Default: ConsoleErrorReporter (logs to stderr).
 * Users implement this interface and bind it in the container
 * to integrate with Sentry, Loki, Bugsnag, etc.
 *
 * Only called for 5xx errors — 4xx are expected client flow, not bugs.
 */

export interface ErrorReporter {
	capture(error: Error, context?: Record<string, unknown>): void;
}

export class ConsoleErrorReporter implements ErrorReporter {
	capture(error: Error, context?: Record<string, unknown>): void {
		console.error("[ErrorReporter]", error, context ?? {});
	}
}
