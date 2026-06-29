import { describe, expect, it } from "bun:test";
import { InMemoryRateLimitStore } from "@ship/Http/InMemoryRateLimitStore";

describe("InMemoryRateLimitStore", () => {
	it("allows requests within the limit", async () => {
		const store = new InMemoryRateLimitStore();
		const result = await store.check("test-key", 3, 60_000);
		expect(result.allowed).toBe(true);
		expect(result.remaining).toBe(2);
		expect(result.limit).toBe(3);
	});

	it("blocks requests exceeding the limit", async () => {
		const store = new InMemoryRateLimitStore();
		await store.check("test-key", 2, 60_000);
		await store.check("test-key", 2, 60_000);
		const result = await store.check("test-key", 2, 60_000);
		expect(result.allowed).toBe(false);
		expect(result.remaining).toBe(0);
	});

	it("tracks remaining count correctly", async () => {
		const store = new InMemoryRateLimitStore();
		const r1 = await store.check("k", 5, 60_000);
		expect(r1.remaining).toBe(4);
		const r2 = await store.check("k", 5, 60_000);
		expect(r2.remaining).toBe(3);
	});

	it("isolates keys from each other", async () => {
		const store = new InMemoryRateLimitStore();
		await store.check("a", 1, 60_000);
		const result = await store.check("b", 1, 60_000);
		expect(result.allowed).toBe(true);
		expect(result.remaining).toBe(0);
	});

	it("resets after the window expires", async () => {
		const store = new InMemoryRateLimitStore();
		// Use a tiny window
		await store.check("k", 1, 1); // 1ms window
		// Wait for window to expire
		await new Promise((r) => setTimeout(r, 5));
		const result = await store.check("k", 1, 1);
		expect(result.allowed).toBe(true);
	});
});
