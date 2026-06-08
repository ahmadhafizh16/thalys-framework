import { Elysia } from "elysia";
import { logger } from "./Ship/logger";
import { userRoutes } from "./Containers/User/UI/API/routes";

const app = new Elysia().use(userRoutes).listen(process.env.PORT ?? 3000);

logger.info(
	{ host: app.server?.hostname, port: app.server?.port },
	"🦊 Elysia running on Bun",
);

const shutdown = async (signal: string) => {
	logger.info({ signal }, "Shutting down");
	await app.stop();
	process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

export type App = typeof app;

