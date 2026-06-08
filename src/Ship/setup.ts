import { Elysia } from "elysia";
import { db } from "./database/connection";
import { AppError, ConflictError, NotFoundError } from "./Exceptions/AppError";
import { logger } from "./logger";

export const shipContext = new Elysia({ name: "ship-infrastructure" })
	.decorate("db", db)
	.decorate("log", logger)
	.error({
		NOT_FOUND: NotFoundError,
		CONFLICT_OCCURRED: ConflictError,
		APP_ERROR: AppError,
	})
	// `as: "global"` propagates this hook to every instance that `.use()`s the
	// ship context. Without it the handler is local-scoped and never fires for
	// errors thrown inside container routes.
	.onError({ as: "global" }, ({ code, error, set }) => {
		if (code === "VALIDATION") {
			set.status = 422;
			return {
				success: false,
				error: "SCHEMA_VALIDATION_FAILED",
				details: error.all,
			};
		}

		if (error instanceof AppError) {
			set.status = error.statusCode;
			return {
				success: false,
				error: error.code,
				message: error.message,
			};
		}

		set.status = 500;
		logger.error({ err: error }, "Unhandled internal exception");
		return {
			success: false,
			error: "UNHANDLED_INTERNAL_ERROR",
			message: "A fatal server exception occurred.",
		};
	});
