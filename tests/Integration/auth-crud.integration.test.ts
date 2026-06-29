import { describe, expect, it } from "bun:test";
import type { SessionDTO } from "@containers/AuthBridge/DTOs/AuthBridgeDTO";
import type { SafeUserOutput } from "@containers/User/Transformers/UserTransformer";
import { AppError, NotFoundError } from "@ship/Exceptions/AppError";
import { InMemoryRateLimitStore } from "@ship/Http/InMemoryRateLimitStore";
import { wrapPaginated, wrapResponse } from "@ship/Http/MainController";
import { can } from "@ship/Http/canMiddleware";
import { rateLimitMiddleware } from "@ship/Http/rateLimitMiddleware";
import { RequestTester } from "@ship/TestHelpers/RequestTester";
import { createMockSession } from "@ship/TestHelpers/mockAuth";
import { Elysia } from "elysia";

interface MockUser {
	id: string;
	name: string;
	email: string;
	phone: string | null;
	profilePic: string | null;
	roleId: string | null;
	createdAt: Date;
	updatedAt: Date;
}

const mockUsers = new Map<string, MockUser>();
const rateLimitStore = new InMemoryRateLimitStore();

const adminSession = createMockSession({
	permissions: [{ resource: "*", action: "*" }],
});
const readerSession = createMockSession({
	userId: "reader-1",
	email: "reader@test.com",
	name: "Reader",
	permissions: [{ resource: "user", action: "read" }],
});
const noPermSession = createMockSession({
	userId: "noperm-1",
	email: "noperm@test.com",
	name: "No Perm",
	permissions: [],
});

function validateToken(token: string): SessionDTO | null {
	if (token === "admin-token") return adminSession;
	if (token === "reader-token") return readerSession;
	if (token === "noperm-token") return noPermSession;
	if (token.startsWith("mock-")) return adminSession;
	return null;
}

function transform(user: MockUser): SafeUserOutput {
	return {
		id: user.id,
		fullName: user.name,
		emailAddress: user.email,
		phone: user.phone,
		profilePic: user.profilePic,
		roleId: user.roleId,
		registeredOn: user.createdAt.toISOString(),
	};
}

function buildApp() {
	return new Elysia({ prefix: "/api" })
		.derive(async ({ request }) => {
			const authHeader = request.headers.get("authorization");
			if (!authHeader?.startsWith("Bearer ")) {
				return { currentUser: undefined as SessionDTO | undefined };
			}
			const token = authHeader.slice(7);
			const session = validateToken(token);
			return { currentUser: session ?? (undefined as SessionDTO | undefined) };
		})
		.onBeforeHandle(rateLimitMiddleware(rateLimitStore, { limit: 100, windowMs: 60_000 }))
		.error({ NOT_FOUND: NotFoundError, APP_ERROR: AppError })
		.onError(({ error, set }) => {
			if (error instanceof AppError) {
				set.status = error.statusCode;
				return { success: false, error: error.code, message: error.message };
			}
			set.status = 500;
			return { success: false, error: "INTERNAL", message: String(error) };
		})
		.post("/v1/auth/login", async ({ body }) => {
			const { email, password } = body as { email: string; password: string };
			const token = `mock-${email}-${password}`;
			const session = validateToken(token);
			if (!session) throw new AppError(401, "INVALID_CREDENTIALS", "Invalid");
			return wrapResponse({ session, token });
		})
		.post("/v1/auth/logout", async ({ request }) => {
			const authHeader = request.headers.get("authorization");
			if (!authHeader?.startsWith("Bearer ")) {
				throw new AppError(401, "UNAUTHORIZED", "No token");
			}
			return wrapResponse({ success: true });
		})
		.post("/v1/users", async ({ body, set }) => {
			const input = body as {
				name: string;
				email: string;
				password: string;
				roleId: string;
				phone?: string;
			};
			const user: MockUser = {
				id: crypto.randomUUID(),
				name: input.name,
				email: input.email,
				phone: input.phone ?? null,
				profilePic: null,
				roleId: input.roleId,
				createdAt: new Date(),
				updatedAt: new Date(),
			};
			mockUsers.set(user.id, user);
			set.status = 201;
			return wrapResponse(transform(user));
		})
		.get("/v1/users", ({ currentUser }) => {
			can("user", "read")({ currentUser });
			const users = Array.from(mockUsers.values()).slice(0, 20);
			return wrapPaginated(users.map(transform), {
				total: mockUsers.size,
				cursor: null,
				hasMore: false,
			});
		})
		.get("/v1/users/:id", ({ params, currentUser }) => {
			can("user", "read")({ currentUser });
			const user = mockUsers.get(params.id);
			if (!user) throw new NotFoundError("User");
			return wrapResponse(transform(user));
		})
		.patch("/v1/users/:id", async ({ params, body, currentUser }) => {
			can("user", "update")({ currentUser });
			const user = mockUsers.get(params.id);
			if (!user) throw new NotFoundError("User");
			const updates = body as Partial<MockUser>;
			const updated = { ...user, ...updates, updatedAt: new Date() };
			mockUsers.set(params.id, updated);
			return wrapResponse(transform(updated));
		})
		.delete("/v1/users/:id", ({ params, currentUser }) => {
			can("user", "delete")({ currentUser });
			const user = mockUsers.get(params.id);
			if (!user) throw new NotFoundError("User");
			mockUsers.delete(params.id);
			return wrapResponse({ success: true });
		});
}

function getTester(): RequestTester {
	return new RequestTester(buildApp());
}

describe("Integration: Auth + User CRUD", () => {
	describe("Auth flow", () => {
		it("POST /api/v1/auth/login returns session + token", async () => {
			const tester = getTester();
			const res = await tester.post("/api/v1/auth/login", {
				email: "admin@test.com",
				password: "password123",
			});

			expect(res.status).toBe(200);
			const body = res.body as { data: { session: SessionDTO; token: string } };
			expect(body.data.session.userId).toBeDefined();
			expect(body.data.token).toContain("mock-");
		});

		it("POST /api/v1/auth/logout with valid token succeeds", async () => {
			const tester = getTester();
			const res = await tester.post("/api/v1/auth/logout", undefined, {
				token: "admin-token",
			});

			expect(res.status).toBe(200);
			expect((res.body as { data: { success: boolean } }).data.success).toBe(true);
		});

		it("POST /api/v1/auth/logout without token returns 401", async () => {
			const tester = getTester();
			const res = await tester.post("/api/v1/auth/logout");
			expect(res.status).toBe(401);
		});
	});

	describe("User CRUD — admin", () => {
		it("POST /api/v1/users creates a user (201)", async () => {
			const tester = getTester();
			const res = await tester.post("/api/v1/users", {
				name: "John Doe",
				email: "john-crud@test.com",
				password: "password123",
				roleId: crypto.randomUUID(),
			});

			expect(res.status).toBe(201);
			const body = res.body as { data: SafeUserOutput };
			expect(body.data.fullName).toBe("John Doe");
			expect(body.data.emailAddress).toBe("john-crud@test.com");
			expect(body.data.id).toBeDefined();
		});

		it("GET /api/v1/users returns paginated list with auth", async () => {
			const tester = getTester();
			const res = await tester.get("/api/v1/users", { token: "admin-token" });

			expect(res.status).toBe(200);
			const body = res.body as { data: SafeUserOutput[]; meta: { total: number } };
			expect(body.data.length).toBeGreaterThan(0);
			expect(body.meta.total).toBeGreaterThan(0);
		});

		it("GET /api/v1/users/:id returns a single user", async () => {
			const tester = getTester();
			const createRes = await tester.post("/api/v1/users", {
				name: "Jane Smith",
				email: "jane-crud@test.com",
				password: "password123",
				roleId: crypto.randomUUID(),
			});
			const userId = (createRes.body as { data: SafeUserOutput }).data.id;

			const res = await tester.get(`/api/v1/users/${userId}`, { token: "admin-token" });

			expect(res.status).toBe(200);
			const body = res.body as { data: SafeUserOutput };
			expect(body.data.fullName).toBe("Jane Smith");
		});

		it("GET /api/v1/users/:id returns 404 for nonexistent user", async () => {
			const tester = getTester();
			const res = await tester.get("/api/v1/users/nonexistent-id", { token: "admin-token" });
			expect(res.status).toBe(404);
		});

		it("PATCH /api/v1/users/:id updates the user", async () => {
			const tester = getTester();
			const createRes = await tester.post("/api/v1/users", {
				name: "Original Name",
				email: "original-crud@test.com",
				password: "password123",
				roleId: crypto.randomUUID(),
			});
			const userId = (createRes.body as { data: SafeUserOutput }).data.id;

			const res = await tester.patch(
				`/api/v1/users/${userId}`,
				{ name: "Updated Name", phone: "+1234567890" },
				{ token: "admin-token" },
			);

			expect(res.status).toBe(200);
			const body = res.body as { data: SafeUserOutput };
			expect(body.data.fullName).toBe("Updated Name");
			expect(body.data.phone).toBe("+1234567890");
		});

		it("DELETE /api/v1/users/:id removes the user", async () => {
			const tester = getTester();
			const createRes = await tester.post("/api/v1/users", {
				name: "Doomed User",
				email: "doomed-crud@test.com",
				password: "password123",
				roleId: crypto.randomUUID(),
			});
			const userId = (createRes.body as { data: SafeUserOutput }).data.id;

			const delRes = await tester.delete(`/api/v1/users/${userId}`, { token: "admin-token" });
			expect(delRes.status).toBe(200);

			const getRes = await tester.get(`/api/v1/users/${userId}`, { token: "admin-token" });
			expect(getRes.status).toBe(404);
		});
	});

	describe("RBAC enforcement", () => {
		it("GET /api/v1/users without token returns 403", async () => {
			const tester = getTester();
			const res = await tester.get("/api/v1/users");
			expect(res.status).toBe(403);
		});

		it("GET /api/v1/users with reader token succeeds", async () => {
			const tester = getTester();
			const res = await tester.get("/api/v1/users", { token: "reader-token" });
			expect(res.status).toBe(200);
		});

		it("PATCH /api/v1/users with reader token returns 403", async () => {
			const tester = getTester();
			const res = await tester.patch(
				"/api/v1/users/some-id",
				{ name: "Hack" },
				{ token: "reader-token" },
			);
			expect(res.status).toBe(403);
		});

		it("GET /api/v1/users with no-perm token returns 403", async () => {
			const tester = getTester();
			const res = await tester.get("/api/v1/users", { token: "noperm-token" });
			expect(res.status).toBe(403);
		});

		it("DELETE /api/v1/users with reader token returns 403", async () => {
			const tester = getTester();
			const res = await tester.delete("/api/v1/users/some-id", { token: "reader-token" });
			expect(res.status).toBe(403);
		});
	});

	describe("Rate limiting", () => {
		it("applies rate limit headers to responses", async () => {
			const tester = getTester();
			const res = await tester.get("/api/v1/users", { token: "admin-token" });
			expect(res.headers["x-ratelimit-limit"]).toBeDefined();
			expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
		});
	});
});
