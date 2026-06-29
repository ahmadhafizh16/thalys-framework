import { describe, expect, it, mock } from "bun:test";
import { healthCheckPlugin } from "@ship/Http/healthCheck";
import { requestLoggerPlugin } from "@ship/Http/requestLogger";
import { RequestTester } from "@ship/TestHelpers/RequestTester";
import type { AppLogger } from "@ship/logger";
import { Elysia } from "elysia";

function createMockLogger(): AppLogger & {
	info: ReturnType<typeof mock>;
	warn: ReturnType<typeof mock>;
	error: ReturnType<typeof mock>;
} {
	return {
		info: mock(() => {}),
		warn: mock(() => {}),
		error: mock(() => {}),
		debug: mock(() => {}),
		fatal: mock(() => {}),
		trace: mock(() => {}),
		child: () => createMockLogger(),
	} as unknown as AppLogger & {
		info: ReturnType<typeof mock>;
		warn: ReturnType<typeof mock>;
		error: ReturnType<typeof mock>;
	};
}

describe("healthCheckPlugin", () => {
	it("returns 200 with database status when DB is reachable", async () => {
		const app = new Elysia().use(healthCheckPlugin);
		const tester = new RequestTester(app);

		const res = await tester.get("/health");
		expect(res.status).toBe(200);
		const body = res.body as {
			status: string;
			checks: { database: { status: string; latencyMs: number } };
			uptime: number;
		};
		expect(body.status).toBe("healthy");
		expect(body.checks.database.status).toBe("ok");
		expect(body.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
		expect(body.uptime).toBeGreaterThanOrEqual(0);
	});

	it("includes redis check when REDIS_URL is set", async () => {
		const app = new Elysia().use(healthCheckPlugin);
		const tester = new RequestTester(app);

		const res = await tester.get("/health");
		const body = res.body as { checks: Record<string, unknown> };

		if (process.env.REDIS_URL) {
			expect(body.checks.redis).toBeDefined();
			expect((body.checks.redis as { status: string }).status).toBe("ok");
		} else {
			expect(body.checks.redis).toBeUndefined();
		}
	});
});

describe("requestLoggerPlugin", () => {
	it("logs a 2xx request at info level", async () => {
		const logger = createMockLogger();
		const app = new Elysia().use(requestLoggerPlugin(logger)).get("/ping", () => ({ pong: true }));

		const tester = new RequestTester(app);
		const res = await tester.get("/ping");
		expect(res.status).toBe(200);

		expect(logger.info).toHaveBeenCalledTimes(1);
		expect(logger.warn).not.toHaveBeenCalled();
		expect(logger.error).not.toHaveBeenCalled();
		const [entry, msg] = logger.info.mock.calls[0] as [Record<string, unknown>, string];
		expect(msg).toBe("request");
		expect(entry.method).toBe("GET");
		expect(entry.path).toBe("/ping");
		expect(entry.status).toBe(200);
		expect(entry.duration as number).toBeGreaterThanOrEqual(0);
	});

	it("logs a 4xx request at warn level", async () => {
		const logger = createMockLogger();
		const app = new Elysia().use(requestLoggerPlugin(logger)).get("/notfound", ({ set }) => {
			set.status = 404;
			return { error: "not found" };
		});

		const tester = new RequestTester(app);
		await tester.get("/notfound");

		expect(logger.warn).toHaveBeenCalledTimes(1);
		expect(logger.info).not.toHaveBeenCalled();
		expect(logger.error).not.toHaveBeenCalled();
		const [entry] = logger.warn.mock.calls[0] as [Record<string, unknown>];
		expect(entry.status).toBe(404);
	});

	it("logs a 5xx request at error level", async () => {
		const logger = createMockLogger();
		const app = new Elysia().use(requestLoggerPlugin(logger)).get("/boom", () => {
			throw new Error("crash");
		});

		const tester = new RequestTester(app);
		await tester.get("/boom");

		expect(logger.error).toHaveBeenCalledTimes(1);
		expect(logger.info).not.toHaveBeenCalled();
		expect(logger.warn).not.toHaveBeenCalled();
		const [entry] = logger.error.mock.calls[0] as [Record<string, unknown>];
		expect(entry.status as number).toBeGreaterThanOrEqual(500);
	});

	it("skips logging for /health requests", async () => {
		const logger = createMockLogger();
		const app = new Elysia()
			.use(requestLoggerPlugin(logger))
			.get("/health", () => ({ status: "ok" }));

		const tester = new RequestTester(app);
		await tester.get("/health");

		expect(logger.info).not.toHaveBeenCalled();
		expect(logger.warn).not.toHaveBeenCalled();
		expect(logger.error).not.toHaveBeenCalled();
	});
});
