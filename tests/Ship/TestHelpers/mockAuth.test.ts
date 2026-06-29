import { describe, expect, it } from "bun:test";
import { createMockAuthBridge, createMockSession } from "@ship/TestHelpers/mockAuth";

describe("createMockSession", () => {
	it("returns a valid SessionDTO shape", () => {
		const session = createMockSession();
		expect(typeof session.userId).toBe("string");
		expect(typeof session.email).toBe("string");
		expect(typeof session.name).toBe("string");
		expect(typeof session.sessionId).toBe("string");
		expect(typeof session.expiresAt).toBe("number");
		expect(session.expiresAt).toBeGreaterThan(Date.now());
	});

	it("generates unique IDs on each call", () => {
		const a = createMockSession();
		const b = createMockSession();
		expect(a.userId).not.toBe(b.userId);
		expect(a.email).not.toBe(b.email);
		expect(a.sessionId).not.toBe(b.sessionId);
	});

	it("applies overrides", () => {
		const session = createMockSession({ email: "admin@test.com", name: "Admin" });
		expect(session.email).toBe("admin@test.com");
		expect(session.name).toBe("Admin");
		expect(typeof session.userId).toBe("string");
	});
});

describe("createMockAuthBridge", () => {
	it("returns a bridge that validates any token", async () => {
		const bridge = createMockAuthBridge();
		const result = await bridge.validateToken("any-token");
		expect(result).not.toBeNull();
		expect(result!.email).toContain("@test.com");
	});

	it("returns the specified session when provided", async () => {
		const session = createMockSession({ email: "specific@test.com" });
		const bridge = createMockAuthBridge(session);
		const result = await bridge.validateToken("token");
		expect(result!.email).toBe("specific@test.com");
	});

	it("logout is a no-op", async () => {
		const bridge = createMockAuthBridge();
		await expect(bridge.logout("session-token")).resolves.toBeUndefined();
	});
});
