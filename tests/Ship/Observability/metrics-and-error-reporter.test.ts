import { describe, expect, it } from "bun:test";
import { ConsoleErrorReporter } from "@ship/Observability/ErrorReporter";
import { MetricsRegistry } from "@ship/Observability/metrics";
import { requestMetricsPlugin } from "@ship/Observability/requestMetrics";
import { RequestTester } from "@ship/TestHelpers/RequestTester";
import { Elysia } from "elysia";

describe("MetricsRegistry", () => {
	it("increments a counter", () => {
		const reg = new MetricsRegistry();
		reg.counter("requests_total", 1, { method: "GET", status: "200" });
		reg.counter("requests_total", 1, { method: "GET", status: "200" });
		reg.counter("requests_total", 1, { method: "POST", status: "201" });

		const output = reg.format();
		expect(output).toContain('requests_total{method="GET",status="200"} 2');
		expect(output).toContain('requests_total{method="POST",status="201"} 1');
		expect(output).toContain("# TYPE requests_total counter");
	});

	it("sets a gauge value (last write wins)", () => {
		const reg = new MetricsRegistry();
		reg.gauge("db_pool_active", 3);
		reg.gauge("db_pool_active", 5);

		const output = reg.format();
		expect(output).toContain("db_pool_active 5");
		expect(output).toContain("# TYPE db_pool_active gauge");
	});

	it("records histogram buckets with cumulative counts", () => {
		const reg = new MetricsRegistry();
		const buckets = [10, 50, 100, Number.POSITIVE_INFINITY];
		reg.histogram("duration_ms", 5, { method: "GET" }, buckets);
		reg.histogram("duration_ms", 45, { method: "GET" }, buckets);
		reg.histogram("duration_ms", 150, { method: "GET" }, buckets);

		const output = reg.format();
		expect(output).toContain('duration_ms_bucket{method="GET",le="10"} 1');
		expect(output).toContain('duration_ms_bucket{method="GET",le="50"} 2');
		expect(output).toContain('duration_ms_bucket{method="GET",le="100"} 2');
		expect(output).toContain('duration_ms_bucket{method="GET",le="+Inf"} 3');
		expect(output).toContain('duration_ms_sum{method="GET"} 200');
		expect(output).toContain('duration_ms_count{method="GET"} 3');
		expect(output).toContain("# TYPE duration_ms histogram");
	});

	it("includes HELP text when provided", () => {
		const reg = new MetricsRegistry();
		reg.counter("requests_total", 1, {}, "Total HTTP requests");

		const output = reg.format();
		expect(output).toContain("# HELP requests_total Total HTTP requests");
	});

	it("isolates labels by their sorted key", () => {
		const reg = new MetricsRegistry();
		reg.counter("requests_total", 1, { status: "200", method: "GET" });
		reg.counter("requests_total", 1, { method: "GET", status: "200" });

		const output = reg.format();
		// Same labels in different order should merge into one counter
		expect(output).toContain('requests_total{method="GET",status="200"} 2');
	});

	it("resets all metrics", () => {
		const reg = new MetricsRegistry();
		reg.counter("requests_total", 5);
		reg.gauge("pool", 3);
		reg.histogram("duration", 10);

		reg.reset();

		const output = reg.format();
		expect(output).toBe("\n");
	});
});

describe("ConsoleErrorReporter", () => {
	it("logs error to stderr without throwing", () => {
		const reporter = new ConsoleErrorReporter();
		const error = new Error("test error");
		expect(() => reporter.capture(error, { path: "/test" })).not.toThrow();
	});
});

describe("requestMetricsPlugin", () => {
	it("increments counter for a 2xx request", async () => {
		const reg = new MetricsRegistry();
		const app = new Elysia().use(requestMetricsPlugin(reg)).get("/ping", () => ({ pong: true }));

		const tester = new RequestTester(app);
		await tester.get("/ping");

		const output = reg.format();
		expect(output).toContain('thalys_requests_total{method="GET",status="200"} 1');
	});

	it("increments counter for a 4xx request", async () => {
		const reg = new MetricsRegistry();
		const app = new Elysia().use(requestMetricsPlugin(reg)).get("/notfound", ({ set }) => {
			set.status = 404;
			return { error: "not found" };
		});

		const tester = new RequestTester(app);
		await tester.get("/notfound");

		const output = reg.format();
		expect(output).toContain('thalys_requests_total{method="GET",status="404"} 1');
	});

	it("increments counter for a 5xx request", async () => {
		const reg = new MetricsRegistry();
		const app = new Elysia().use(requestMetricsPlugin(reg)).get("/boom", () => {
			throw new Error("crash");
		});

		const tester = new RequestTester(app);
		await tester.get("/boom");

		const output = reg.format();
		expect(output).toContain('thalys_requests_total{method="GET",status="500"} 1');
	});

	it("records duration histogram", async () => {
		const reg = new MetricsRegistry();
		const app = new Elysia().use(requestMetricsPlugin(reg)).get("/ping", () => ({ pong: true }));

		const tester = new RequestTester(app);
		await tester.get("/ping");

		const output = reg.format();
		expect(output).toContain("thalys_request_duration_ms_bucket");
		expect(output).toContain("thalys_request_duration_ms_sum");
		expect(output).toContain("thalys_request_duration_ms_count");
	});

	it("skips /health and /metrics paths", async () => {
		const reg = new MetricsRegistry();
		const app = new Elysia()
			.use(requestMetricsPlugin(reg))
			.get("/health", () => ({ status: "ok" }))
			.get("/metrics", () => "metrics");

		const tester = new RequestTester(app);
		await tester.get("/health");
		await tester.get("/metrics");

		const output = reg.format();
		expect(output).toBe("\n");
	});
});
