import { describe, expect, it } from "bun:test";
import { AppError } from "@ship/Exceptions/AppError";
import { InMemoryRateLimitStore } from "@ship/Http/InMemoryRateLimitStore";
import { wrapResponse } from "@ship/Http/MainController";
import { rateLimitMiddleware } from "@ship/Http/rateLimitMiddleware";
import { RequestTester } from "@ship/TestHelpers/RequestTester";
import { Elysia } from "elysia";

describe("Minimal integration", () => {
	it("should return 200", async () => {
		const store = new InMemoryRateLimitStore();
		const app = new Elysia({ prefix: "/api" })
			.onBeforeHandle(rateLimitMiddleware(store, { limit: 100, windowMs: 60_000 }))
			.error({ APP_ERROR: AppError })
			.onError(({ error, set }) => {
				set.status = 500;
				return { error: String(error) };
			})
			.get("/v1/test", () => wrapResponse({ ok: true }));

		const tester = new RequestTester(app);
		const res = await tester.get("/api/v1/test");
		expect(res.status).toBe(200);
		expect((res.body as { data: { ok: boolean } }).data.ok).toBe(true);
	});
});
