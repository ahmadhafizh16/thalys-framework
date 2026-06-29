import { describe, expect, it, mock } from "bun:test";
import { GetUserPermissionsTask } from "@containers/Auth/Tasks/GetUserPermissionsTask";
import { LoginTask } from "@containers/Auth/Tasks/LoginTask";
import { LogoutTask } from "@containers/Auth/Tasks/LogoutTask";
import { RegisterTask } from "@containers/Auth/Tasks/RegisterTask";
import { ValidateTokenTask } from "@containers/Auth/Tasks/ValidateTokenTask";

function createMockAuth(opts?: {
	signInResult?: { token: string; user: { id: string; email: string; name: string } } | null;
	signUpResult?: { token: string; user: { id: string; email: string; name: string } } | null;
	sessionResult?: {
		user: { id: string; email: string; name: string };
		session: { id: string; expiresAt: Date };
	} | null;
}) {
	const signInEmail = mock(() => Promise.resolve(opts?.signInResult ?? null));
	const signUpEmail = mock(() => Promise.resolve(opts?.signUpResult ?? null));
	const getSession = mock(() => Promise.resolve(opts?.sessionResult ?? null));
	const revokeSession = mock(() => Promise.resolve(undefined));

	return {
		api: { signInEmail, signUpEmail, getSession, revokeSession },
	} as unknown as typeof import("@containers/Auth/betterAuth.config").auth;
}

describe("LoginTask", () => {
	it("returns a session with correct sessionId from getSession, not user.id", async () => {
		const mockAuth = createMockAuth({
			signInResult: {
				token: "tok-123",
				user: { id: "user-1", email: "a@b.com", name: "Alice" },
			},
			sessionResult: {
				user: { id: "user-1", email: "a@b.com", name: "Alice" },
				session: { id: "sess-999", expiresAt: new Date("2026-07-01") },
			},
		});

		const task = new LoginTask(mockAuth);
		const result = await task.run({ email: "a@b.com", password: "password123" });

		expect(result.token).toBe("tok-123");
		expect(result.session.userId).toBe("user-1");
		expect(result.session.sessionId).toBe("sess-999");
		expect(result.session.email).toBe("a@b.com");
		expect(result.session.expiresAt).toBe(new Date("2026-07-01").getTime());
	});

	it("throws INVALID_CREDENTIALS when signInEmail returns no token", async () => {
		const mockAuth = createMockAuth({ signInResult: null });
		const task = new LoginTask(mockAuth);

		expect(async () => {
			await task.run({ email: "x@y.com", password: "wrong" });
		}).toThrow();
	});

	it("throws when getSession returns null after successful sign-in", async () => {
		const mockAuth = createMockAuth({
			signInResult: { token: "tok", user: { id: "u1", email: "a@b.com", name: "A" } },
			sessionResult: null,
		});
		const task = new LoginTask(mockAuth);

		expect(async () => {
			await task.run({ email: "a@b.com", password: "password123" });
		}).toThrow();
	});
});

describe("RegisterTask", () => {
	it("returns a session with correct sessionId from getSession", async () => {
		const mockAuth = createMockAuth({
			signUpResult: {
				token: "reg-tok",
				user: { id: "user-2", email: "new@test.com", name: "New" },
			},
			sessionResult: {
				user: { id: "user-2", email: "new@test.com", name: "New" },
				session: { id: "sess-register", expiresAt: new Date("2026-08-01") },
			},
		});

		const task = new RegisterTask(mockAuth);
		const result = await task.run({
			name: "New User",
			email: "new@test.com",
			password: "password123",
		});

		expect(result.token).toBe("reg-tok");
		expect(result.session.userId).toBe("user-2");
		expect(result.session.sessionId).toBe("sess-register");
	});

	it("throws REGISTRATION_FAILED when signUpEmail returns no token", async () => {
		const mockAuth = createMockAuth({ signUpResult: null });
		const task = new RegisterTask(mockAuth);

		expect(async () => {
			await task.run({ name: "X", email: "x@y.com", password: "password123" });
		}).toThrow();
	});
});

describe("ValidateTokenTask", () => {
	it("returns AuthSessionDTO when session is valid", async () => {
		const mockAuth = createMockAuth({
			sessionResult: {
				user: { id: "user-1", email: "a@b.com", name: "Alice" },
				session: { id: "sess-1", expiresAt: new Date("2026-12-01") },
			},
		});

		const task = new ValidateTokenTask(mockAuth);
		const result = await task.run("valid-token");

		expect(result).not.toBeNull();
		expect(result!.userId).toBe("user-1");
		expect(result!.sessionId).toBe("sess-1");
	});

	it("returns null when getSession returns null", async () => {
		const mockAuth = createMockAuth({ sessionResult: null });
		const task = new ValidateTokenTask(mockAuth);

		const result = await task.run("invalid-token");
		expect(result).toBeNull();
	});

	it("returns null when getSession throws", async () => {
		const mockAuth: unknown = {
			api: {
				getSession: () => Promise.reject(new Error("network")),
				signInEmail: () => Promise.resolve(null),
				signUpEmail: () => Promise.resolve(null),
				revokeSession: () => Promise.resolve(undefined),
			},
		};

		const task = new ValidateTokenTask(mockAuth as never);
		const result = await task.run("bad-token");
		expect(result).toBeNull();
	});
});

describe("LogoutTask", () => {
	it("calls revokeSession with the token", async () => {
		const mockAuth = createMockAuth();
		const task = new LogoutTask(mockAuth);

		await task.run("session-token-123");

		expect(mockAuth.api.revokeSession).toHaveBeenCalledTimes(1);
	});

	it("does not throw when revokeSession fails", async () => {
		const mockAuth: unknown = {
			api: {
				getSession: () => Promise.resolve(null),
				signInEmail: () => Promise.resolve(null),
				signUpEmail: () => Promise.resolve(null),
				revokeSession: () => Promise.reject(new Error("already revoked")),
			},
		};

		const task = new LogoutTask(mockAuth as never);
		await task.run("expired-token");
	});
});

describe("GetUserPermissionsTask", () => {
	it("returns permissions for a user via JOIN", async () => {
		const mockDbClient = {
			select: mock(() => ({
				from: mock(() => ({
					innerJoin: mock(() => ({
						where: mock(() =>
							Promise.resolve([
								{ resource: "user", action: "read" },
								{ resource: "user", action: "create" },
							]),
						),
					})),
				})),
			})),
		};

		const task = new GetUserPermissionsTask(mockDbClient as never);
		const result = await task.run("user-1");

		expect(result).toHaveLength(2);
		expect(result[0]!.resource).toBe("user");
		expect(result[1]!.action).toBe("create");
	});

	it("returns empty array when user has no role", async () => {
		const mockDbClient = {
			select: mock(() => ({
				from: mock(() => ({
					innerJoin: mock(() => ({
						where: mock(() => Promise.resolve([])),
					})),
				})),
			})),
		};

		const task = new GetUserPermissionsTask(mockDbClient as never);
		const result = await task.run("user-no-role");
		expect(result).toEqual([]);
	});
});
