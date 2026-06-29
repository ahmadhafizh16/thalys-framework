import { describe, expect, it } from "bun:test";
import { RequestTester } from "@ship/TestHelpers/RequestTester";
import { Elysia } from "elysia";

describe("RequestTester", () => {
	function createApp() {
		return new Elysia()
			.get("/ping", () => ({ pong: true }))
			.post("/echo", ({ body }) => ({ received: body }))
			.get("/headers", ({ request }) => ({
				auth: request.headers.get("authorization"),
				contentType: request.headers.get("content-type"),
			}))
			.get("/error", () => {
				throw new Error("boom");
			});
	}

	it("sends a GET request and parses JSON response", async () => {
		const tester = new RequestTester(createApp());
		const res = await tester.get("/ping");
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ pong: true });
	});

	it("sends a POST request with a JSON body", async () => {
		const tester = new RequestTester(createApp());
		const res = await tester.post("/echo", { hello: "world" });
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ received: { hello: "world" } });
	});

	it("passes authorization header via token option", async () => {
		const tester = new RequestTester(createApp());
		const res = await tester.get("/headers", { token: "my-secret-token" });
		expect(res.status).toBe(200);
		expect((res.body as { auth: string }).auth).toBe("Bearer my-secret-token");
	});

	it("passes custom headers", async () => {
		const tester = new RequestTester(createApp());
		const res = await tester.get("/headers", {
			headers: { "x-custom": "test-value" },
		});
		expect(res.status).toBe(200);
	});

	it("captures response headers", async () => {
		const app = new Elysia().get("/with-header", ({ set }) => {
			set.headers["x-request-id"] = "abc-123";
			return { ok: true };
		});
		const tester = new RequestTester(app);
		const res = await tester.get("/with-header");
		expect(res.headers["x-request-id"]).toBe("abc-123");
	});

	it("handles non-JSON response bodies gracefully", async () => {
		const app = new Elysia().get("/text", () => new Response("raw text", { status: 200 }));
		const tester = new RequestTester(app);
		const res = await tester.get("/text");
		expect(res.status).toBe(200);
		expect(res.body).toBe("raw text");
	});

	it("sends PUT requests", async () => {
		const tester = new RequestTester(createApp());
		const res = await tester.post("/echo", { updated: true });
		expect(res.status).toBe(200);
	});

	it("sends DELETE requests", async () => {
		const app = new Elysia().delete("/resource", () => ({ deleted: true }));
		const tester = new RequestTester(app);
		const res = await tester.delete("/resource");
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ deleted: true });
	});
});
