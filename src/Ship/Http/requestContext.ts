import { randomUUID } from "node:crypto";
import { Elysia } from "elysia";

export const requestContext = new Elysia({ name: "request-context" })
	.derive({ as: "global" }, ({ request }: { request: Request }) => ({
		requestId: request.headers.get("x-request-id") ?? randomUUID(),
		requestStartedAt: Date.now(),
	}))
	.onAfterResponse({ as: "global" }, (ctx) => {
		const set = ctx.set as { headers: Record<string, string> };
		set.headers["X-Request-Id"] = ctx.requestId;
		set.headers["X-Response-Time"] = `${Date.now() - ctx.requestStartedAt}ms`;
	});
