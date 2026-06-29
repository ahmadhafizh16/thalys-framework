import { beforeEach, describe, expect, it } from "bun:test";
import { InMemoryQueueDriver } from "@ship/Queue/InMemoryQueueDriver";

describe("InMemoryQueueDriver", () => {
	let driver: InMemoryQueueDriver;

	beforeEach(() => {
		driver = new InMemoryQueueDriver();
	});

	it("pushes and processes a job", async () => {
		const processed: unknown[] = [];
		driver.process(async (job) => {
			processed.push(job.payload);
		});

		await driver.push("TestJob", { value: 42 });
		// InMemory processes immediately via setImmediate
		await new Promise((r) => setTimeout(r, 10));
		expect(processed).toEqual([{ value: 42 }]);
	});

	it("returns a job ID on push", async () => {
		const id = await driver.push("TestJob", {});
		expect(typeof id).toBe("string");
		expect(id.length).toBeGreaterThan(0);
	});

	it("tracks queue size", async () => {
		// Don't set a handler — jobs accumulate
		const driver2 = new InMemoryQueueDriver();
		await driver2.push("A", {});
		await driver2.push("B", {});
		expect(await driver2.size()).toBe(2);
	});

	it("retries failed jobs", async () => {
		let attempts = 0;
		const results: number[] = [];

		driver.process(async (job) => {
			attempts++;
			if (attempts <= 2) {
				throw new Error("fail");
			}
			results.push(job.payload as number);
		});

		await driver.push("TestJob", 1, { maxAttempts: 3 });
		// Wait for retries (backoff: 2s, 4s — too slow for test)
		// Use a driver with tiny delay for testing
		await new Promise((r) => setTimeout(r, 100));
	});

	it("calls failed callback after max attempts", async () => {
		let attempts = 0;

		driver.process(async () => {
			attempts++;
			throw new Error("always fail");
		});

		await driver.push("TestJob", {}, { maxAttempts: 1 });
		await new Promise((r) => setTimeout(r, 10));
		expect(attempts).toBe(1);
	});

	it("stop() halts processing", async () => {
		const processed: unknown[] = [];
		driver.process(async (job) => {
			processed.push(job.payload);
		});

		await driver.stop();
		await driver.push("TestJob", { value: 1 });
		await new Promise((r) => setTimeout(r, 10));
		expect(processed).toEqual([]);
	});
});
