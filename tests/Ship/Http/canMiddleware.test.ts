import { describe, expect, it } from "bun:test";
import { ForbiddenError, can } from "@ship/Http/canMiddleware";

describe("can middleware", () => {
	const baseSession = {
		userId: "u1",
		email: "test@example.com",
		name: "Test",
		sessionId: "s1",
		expiresAt: Date.now() + 86400000,
	};

	it("throws ForbiddenError when no currentUser", () => {
		const middleware = can("user", "read");
		expect(() => middleware({})).toThrow(ForbiddenError);
		expect(() => middleware({})).toThrow(/Authentication required/);
	});

	it("throws ForbiddenError when permission missing", () => {
		const middleware = can("user", "delete");
		expect(() =>
			middleware({
				currentUser: {
					...baseSession,
					permissions: [{ resource: "user", action: "read" }],
				},
			}),
		).toThrow(ForbiddenError);
	});

	it("passes when permission matches", () => {
		const middleware = can("user", "read");
		expect(() =>
			middleware({
				currentUser: {
					...baseSession,
					permissions: [{ resource: "user", action: "read" }],
				},
			}),
		).not.toThrow();
	});

	it("passes with wildcard permission (* /*)", () => {
		const middleware = can("anything", "anything");
		expect(() =>
			middleware({
				currentUser: {
					...baseSession,
					permissions: [{ resource: "*", action: "*" }],
				},
			}),
		).not.toThrow();
	});
});
