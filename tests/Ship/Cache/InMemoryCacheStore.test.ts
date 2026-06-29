import { beforeEach, describe, expect, it } from "bun:test";
import { InMemoryCacheStore } from "@ship/Cache/InMemoryCacheStore";
import { remember } from "@ship/Cache/remember";

describe("InMemoryCacheStore", () => {
	let cache: InMemoryCacheStore;

	beforeEach(() => {
		cache = new InMemoryCacheStore();
	});

	describe("get/set", () => {
		it("returns null for missing keys", async () => {
			expect(await cache.get("missing")).toBeNull();
		});

		it("stores and retrieves a value", async () => {
			await cache.set("key", { name: "test" });
			const result = await cache.get<{ name: string }>("key");
			expect(result).toEqual({ name: "test" });
		});

		it("returns null for expired entries", async () => {
			await cache.set("key", "value", 1); // 1ms TTL
			await new Promise((r) => setTimeout(r, 5));
			expect(await cache.get("key")).toBeNull();
		});

		it("overwrites existing keys", async () => {
			await cache.set("key", "old");
			await cache.set("key", "new");
			expect(await cache.get<string>("key")).toBe("new");
		});
	});

	describe("forget", () => {
		it("deletes a key", async () => {
			await cache.set("key", "value");
			await cache.forget("key");
			expect(await cache.get("key")).toBeNull();
		});
	});

	describe("has", () => {
		it("returns false for missing keys", async () => {
			expect(await cache.has("missing")).toBe(false);
		});

		it("returns true for existing keys", async () => {
			await cache.set("key", "value");
			expect(await cache.has("key")).toBe(true);
		});

		it("returns false for expired keys", async () => {
			await cache.set("key", "value", 1);
			await new Promise((r) => setTimeout(r, 5));
			expect(await cache.has("key")).toBe(false);
		});
	});

	describe("flush", () => {
		it("clears all entries", async () => {
			await cache.set("a", 1);
			await cache.set("b", 2);
			await cache.flush();
			expect(await cache.get("a")).toBeNull();
			expect(await cache.get("b")).toBeNull();
		});
	});

	describe("tag", () => {
		it("stores and retrieves tagged values", async () => {
			await cache.tag("users").set("user:1", { name: "Ada" });
			const result = await cache.tag("users").get<{ name: string }>("user:1");
			expect(result).toEqual({ name: "Ada" });
		});

		it("isolates tagged keys from untagged", async () => {
			await cache.set("key", "untagged");
			await cache.tag("users").set("key", "tagged");
			expect(await cache.get<string>("key")).toBe("untagged");
			expect(await cache.tag("users").get<string>("key")).toBe("tagged");
		});

		it("flushes all keys with a given tag", async () => {
			await cache.tag("users").set("a", 1);
			await cache.tag("users").set("b", 2);
			await cache.tag("orders").set("c", 3);
			await cache.tag("users").flush();
			expect(await cache.tag("users").get("a")).toBeNull();
			expect(await cache.tag("users").get("b")).toBeNull();
			expect(await cache.tag("orders").get<number>("c")).toEqual(3);
		});
	});
});

describe("remember", () => {
	it("returns cached value on second call", async () => {
		const cache = new InMemoryCacheStore();
		let callCount = 0;
		const fn = async () => {
			callCount++;
			return "result";
		};

		const r1 = await remember(cache, "key", 60_000, fn);
		const r2 = await remember(cache, "key", 60_000, fn);

		expect(r1).toBe("result");
		expect(r2).toBe("result");
		expect(callCount).toBe(1); // fn called only once
	});

	it("re-fetches after TTL expires", async () => {
		const cache = new InMemoryCacheStore();
		let callCount = 0;
		const fn = async () => ++callCount;

		await remember(cache, "key", 1, fn); // 1ms TTL
		await new Promise((r) => setTimeout(r, 5));
		const result = await remember(cache, "key", 60_000, fn);

		expect(result).toBe(2);
		expect(callCount).toBe(2);
	});
});
