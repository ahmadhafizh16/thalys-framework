import pino, { type Logger } from "pino";

// Two transport targets: structured logs to MongoDB (durable) and a
// human-readable stream to stdout in dev. Transports run in a worker thread,
// so logging never blocks the request path.
const targets: pino.TransportTargetOptions[] = [
	{
		target: "pino-mongodb",
		level: process.env.LOG_LEVEL ?? "info",
		options: {
			uri: process.env.MONGO_URL ?? "mongodb://127.0.0.1:30003/?authSource=admin",
			database: process.env.LOG_DB_NAME ?? "logs",
			collection: process.env.LOG_COLLECTION ?? "app_logs",
		},
	},
];

if (process.env.NODE_ENV !== "production") {
	targets.push({
		target: "pino-pretty",
		level: process.env.LOG_LEVEL ?? "debug",
		options: { colorize: true },
	});
}

export const logger: Logger = pino({
	level: process.env.LOG_LEVEL ?? "info",
	transport: { targets },
});

export type AppLogger = Logger;
