import type { AppLogger } from "@ship/logger";
import { Elysia } from "elysia";

/**
 * Skip logging for health check requests — they're noise from orchestrators.
 */
function shouldSkip(path: string): boolean {
	return path === "/api/health" || path === "/health";
}

/**
 * Structured request logging plugin.
 * Logs one Pino entry per request with method, path, status, duration, userId.
 * 4xx logged at warn, 5xx at error, 2xx at info.
 *
 * Uses `onAfterHandle` for successful responses and `onError` for error
 * responses. `onAfterResponse` does not fire when testing via `app.handle()`,
 * and `onAfterHandle` doesn't fire when an error is thrown (Elysia routes to
 * `onError` instead). Hooking both ensures every request is logged.
 */
export function requestLoggerPlugin(logger: AppLogger) {
	return new Elysia({ name: "request-logger" })
		.derive({ as: "global" }, () => ({
			_logStartedAt: Date.now(),
		}))
		.onAfterHandle({ as: "global" }, (ctx) => {
			const url = new URL(ctx.request.url);
			if (shouldSkip(url.pathname)) return;

			logRequest(logger, ctx);
		})
		.onError({ as: "global" }, (ctx) => {
			const url = new URL(ctx.request.url);
			if (shouldSkip(url.pathname)) return;

			logRequest(logger, ctx);

			// Don't return anything — let the global error handler format the response
		});
}

function logRequest(
	logger: AppLogger,
	ctx: {
		request: Request;
		set: { status?: number | string };
		// biome-ignore lint/suspicious/noExplicitAny: currentUser injected by authContext
		currentUser?: any;
		requestId?: string;
		_logStartedAt?: number;
	},
): void {
	const url = new URL(ctx.request.url);
	const start = ctx._logStartedAt;
	const duration = start !== undefined ? Date.now() - start : 0;
	const rawStatus = ctx.set.status;
	const status =
		typeof rawStatus === "string" ? Number.parseInt(rawStatus, 10) : (rawStatus ?? 500);

	const entry = {
		requestId: ctx.requestId,
		method: ctx.request.method,
		path: url.pathname,
		status,
		duration,
		userId: ctx.currentUser?.userId,
		ip: ctx.request.headers.get("x-forwarded-for") ?? "127.0.0.1",
	};

	if (status >= 500) {
		logger.error(entry, "request");
	} else if (status >= 400) {
		logger.warn(entry, "request");
	} else {
		logger.info(entry, "request");
	}
}
