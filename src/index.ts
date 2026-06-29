import { Elysia } from "elysia";
import { authRoutesV1 } from "./Containers/Auth/UI/API/v1/routes";
import { userRoutesV1 } from "./Containers/User/UI/API/v1/routes";
// {{GENERATOR_ROUTE_IMPORTS}}
import { RedisCacheStore } from "./Ship/Cache/RedisCacheStore";
import { healthCheckPlugin } from "./Ship/Http/healthCheck";
import { requestLoggerPlugin } from "./Ship/Http/requestLogger";
import { swaggerPlugin } from "./Ship/Http/swaggerPlugin";
import { metricsRegistry } from "./Ship/Observability/metrics";
import { requestMetricsPlugin } from "./Ship/Observability/requestMetrics";
import { logger } from "./Ship/logger";
import { container } from "./Ship/setup";

const app = new Elysia({ prefix: "/api" })
	.use(requestLoggerPlugin(logger))
	.use(requestMetricsPlugin(metricsRegistry))
	.use(healthCheckPlugin)
	.get("/metrics", () => {
		const text = metricsRegistry.format();
		return new Response(text, {
			headers: { "content-type": "text/plain; version=0.0.4" },
		});
	})
	.use(swaggerPlugin)
	.use(authRoutesV1)
	.use(userRoutesV1)
	// {{GENERATOR_ROUTE_MOUNTS}}
	.listen(process.env.PORT ?? 3000);

logger.info({ host: app.server?.hostname, port: app.server?.port }, "🦊 Elysia running on Bun");

const shutdown = async (signal: string) => {
	logger.info({ signal }, "Shutting down");
	const cache = container.make("cache" as never) as unknown;
	if (cache instanceof RedisCacheStore) await cache.disconnect();
	await app.stop();
	process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

export type App = typeof app;
