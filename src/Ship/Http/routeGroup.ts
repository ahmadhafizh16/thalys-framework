import { container, shipContext } from "@ship/setup";
import { Elysia } from "elysia";
import type { RateLimitStore } from "./RateLimiter";
import { authContext } from "./authContext";
import { rateLimitMiddleware } from "./rateLimitMiddleware";
import { RATE_LIMIT_PRESETS } from "./rateLimitPresets";

type RoutePreset = keyof typeof RATE_LIMIT_PRESETS;

/**
 * Creates an Elysia instance with the standard middleware stack:
 * shipContext (db/log/container) + authContext (currentUser) + rate limiting.
 *
 * The "auth" preset skips authContext — use it for routes that don't
 * require an existing session (e.g. login, register).
 */
export function routeGroup(prefix: string, preset: RoutePreset = "api") {
	const store = container.make<RateLimitStore>("rateLimitStore");
	const instance = new Elysia({ prefix }).use(shipContext);

	if (preset !== "auth") {
		instance.use(authContext);
	}

	return instance.onBeforeHandle(async (ctx) => {
		await rateLimitMiddleware(store, RATE_LIMIT_PRESETS[preset])(ctx);
	});
}
