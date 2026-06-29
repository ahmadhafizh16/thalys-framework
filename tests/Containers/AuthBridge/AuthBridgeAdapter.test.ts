import { describe, expect, it, mock } from "bun:test";
import type { AuthSessionDTO } from "@containers/Auth/DTOs/AuthDTO";
import { InProcessAuthBridgeAdapter } from "@containers/AuthBridge/Adapters/InProcessAuthBridgeAdapter";

function createMockDeps(opts?: {
	authSession?: AuthSessionDTO | null;
	permissions?: { resource: string; action: string }[];
}) {
	const validateTokenAction = {
		execute: mock(() => Promise.resolve(opts?.authSession ?? null)),
	};
	const logoutAction = {
		execute: mock(() => Promise.resolve(undefined)),
	};
	const getUserPermissionsTask = {
		run: mock(() => Promise.resolve(opts?.permissions ?? [])),
	};

	return { validateTokenAction, logoutAction, getUserPermissionsTask };
}

describe("InProcessAuthBridgeAdapter", () => {
	it("returns a SessionDTO with permissions when token is valid", async () => {
		const deps = createMockDeps({
			authSession: {
				userId: "u1",
				email: "a@b.com",
				name: "Alice",
				sessionId: "sess-1",
				expiresAt: Date.now() + 3600_000,
			},
			permissions: [
				{ resource: "user", action: "read" },
				{ resource: "user", action: "create" },
			],
		});

		const adapter = new InProcessAuthBridgeAdapter(
			deps.validateTokenAction as never,
			deps.logoutAction as never,
			deps.getUserPermissionsTask as never,
		);

		const result = await adapter.validateToken("valid-token");

		expect(result).not.toBeNull();
		expect(result!.userId).toBe("u1");
		expect(result!.permissions).toHaveLength(2);
		expect(result!.permissions[0]!.resource).toBe("user");
	});

	it("returns null when token is invalid", async () => {
		const deps = createMockDeps({ authSession: null });
		const adapter = new InProcessAuthBridgeAdapter(
			deps.validateTokenAction as never,
			deps.logoutAction as never,
			deps.getUserPermissionsTask as never,
		);

		const result = await adapter.validateToken("invalid-token");
		expect(result).toBeNull();
	});

	it("returns empty permissions when user has no role", async () => {
		const deps = createMockDeps({
			authSession: {
				userId: "u2",
				email: "x@y.com",
				name: "No Role",
				sessionId: "sess-2",
				expiresAt: Date.now() + 3600_000,
			},
			permissions: [],
		});

		const adapter = new InProcessAuthBridgeAdapter(
			deps.validateTokenAction as never,
			deps.logoutAction as never,
			deps.getUserPermissionsTask as never,
		);

		const result = await adapter.validateToken("token");
		expect(result!.permissions).toEqual([]);
	});

	it("returns empty permissions when permission lookup throws", async () => {
		const deps = createMockDeps({
			authSession: {
				userId: "u3",
				email: "x@y.com",
				name: "Error",
				sessionId: "sess-3",
				expiresAt: Date.now() + 3600_000,
			},
		});
		deps.getUserPermissionsTask.run = mock(() => Promise.reject(new Error("DB error")));

		const adapter = new InProcessAuthBridgeAdapter(
			deps.validateTokenAction as never,
			deps.logoutAction as never,
			deps.getUserPermissionsTask as never,
		);

		const result = await adapter.validateToken("token");
		expect(result).not.toBeNull();
		expect(result!.permissions).toEqual([]); // graceful fallback
	});

	it("delegates logout to the logout action", async () => {
		const deps = createMockDeps();
		const adapter = new InProcessAuthBridgeAdapter(
			deps.validateTokenAction as never,
			deps.logoutAction as never,
			deps.getUserPermissionsTask as never,
		);

		await adapter.logout("session-token");

		expect(deps.logoutAction.execute).toHaveBeenCalledWith("session-token");
	});
});
