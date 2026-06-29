import { describe, expect, it } from "bun:test";
import { RollbackSignal } from "@ship/TestHelpers/withTestTransaction";

describe("RollbackSignal", () => {
	it("is an instance of Error", () => {
		const signal = new RollbackSignal();
		expect(signal).toBeInstanceOf(Error);
		expect(signal).toBeInstanceOf(RollbackSignal);
	});

	it("has the correct name", () => {
		const signal = new RollbackSignal();
		expect(signal.name).toBe("RollbackSignal");
	});

	it("has the sentinel message", () => {
		const signal = new RollbackSignal();
		expect(signal.message).toBe("__ROLLBACK__");
	});

	it("can be distinguished from regular errors in a catch block", () => {
		try {
			throw new RollbackSignal();
		} catch (error) {
			expect(error).toBeInstanceOf(RollbackSignal);
			expect(error).not.toBeInstanceOf(TypeError);
		}
	});

	it("preserves instanceof when thrown from async context", async () => {
		const thrown = await new Promise((resolve) => {
			setTimeout(() => {
				try {
					throw new RollbackSignal();
				} catch (e) {
					resolve(e);
				}
			}, 1);
		});
		expect(thrown).toBeInstanceOf(RollbackSignal);
	});
});
