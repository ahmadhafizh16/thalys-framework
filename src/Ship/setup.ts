import { APIError } from "better-auth";
import { Elysia } from "elysia";
import { createContainer } from "./Container/registerServices";
import { AppError, ConflictError, NotFoundError } from "./Exceptions/AppError";
import { RequestValidationError } from "./Http/BaseRequest";
import { profilerPlugin } from "./Http/profiler";
import { requestContext } from "./Http/requestContext";
import { lz, parseLocale } from "./Localization/lz";
import type { ErrorReporter } from "./Observability/ErrorReporter";
import { db } from "./database/connection";
import { wrapDbWithQueryCounter } from "./database/queryCounter";
import { logger } from "./logger";

const profiledDb = wrapDbWithQueryCounter(db);

export const container = createContainer(profiledDb);

export const shipContext = new Elysia({ name: "ship-infrastructure" })
	.use(requestContext)
	.use(profilerPlugin)
	.decorate("db", profiledDb)
	.decorate("log", logger)
	.decorate("container", container)
	.error({
		NOT_FOUND: NotFoundError,
		CONFLICT_OCCURRED: ConflictError,
		INVALID_REQUEST: RequestValidationError,
		APP_ERROR: AppError,
	})
	// `as: "global"` propagates this hook to every instance that `.use()`s the
	// ship context. Without it the handler is local-scoped and never fires for
	// errors thrown inside container routes.
	.onError({ as: "global" }, ({ code, error, set, request }) => {
		const locale = parseLocale(request.headers.get("accept-language"));

		if (code === "VALIDATION") {
			set.status = 422;
			return {
				success: false,
				error: "SCHEMA_VALIDATION_FAILED",
				message: lz("errors.SCHEMA_VALIDATION_FAILED", locale),
				details: error.all,
			};
		}

		if (error instanceof AppError) {
			set.status = error.statusCode;
			const message = error.messageKey
				? lz(error.messageKey, locale, error.messageParams)
				: error.message;
			return {
				success: false,
				error: error.code,
				message,
			};
		}

		// Better Auth throws APIError — map to our error envelope
		if (error instanceof APIError) {
			const statusMap: Record<string, number> = {
				UNAUTHORIZED: 401,
				FORBIDDEN: 403,
				NOT_FOUND: 404,
				CONFLICT: 409,
				BAD_REQUEST: 400,
				TOO_MANY_REQUESTS: 429,
				INTERNAL_SERVER_ERROR: 500,
			};
			set.status = statusMap[error.status] ?? 500;
			if (set.status >= 500) {
				container
					.make<ErrorReporter>("ErrorReporter")
					.capture(error as Error, { path: request.url });
			}
			return {
				success: false,
				error: "AUTH_ERROR",
				message: error.body?.message ?? error.message,
			};
		}

		set.status = 500;
		logger.error({ err: error }, "Unhandled internal exception");
		container.make<ErrorReporter>("ErrorReporter").capture(error as Error, { path: request.url });
		return {
			success: false,
			error: "UNHANDLED_INTERNAL_ERROR",
			message: lz("errors.UNHANDLED_INTERNAL_ERROR", locale),
		};
	});
