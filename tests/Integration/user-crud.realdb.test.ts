import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { rolesTable } from "@containers/Auth/Models/role.schema";
import { usersTable } from "@containers/User/Models/user.schema";
import type { SafeUserOutput } from "@containers/User/Transformers/UserTransformer";
import { userRoutesV1 } from "@containers/User/UI/API/v1/routes";
import { createTestApp } from "@ship/TestHelpers";
import { RequestTester } from "@ship/TestHelpers/RequestTester";
import { createMockAuthBridge, createMockSession } from "@ship/TestHelpers/mockAuth";
import { db } from "@ship/database/connection";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

// ── Helpers ────────────────────────────────────────────────

const adminSession = createMockSession({
	permissions: [{ resource: "*", action: "*" }],
});
const readerSession = createMockSession({
	userId: "reader-1",
	email: "reader@test.com",
	name: "Reader",
	permissions: [{ resource: "user", action: "read" }],
});

let testRoleId: string;

async function truncateUsers() {
	await db.execute(sql`TRUNCATE TABLE users CASCADE`);
}

async function seedRole(): Promise<string> {
	const existing = await db.select().from(rolesTable).limit(1);
	if (existing.length > 0) return existing[0]!.id;

	const [role] = await db
		.insert(rolesTable)
		.values({ name: "test-admin", description: "Test admin role" })
		.returning();
	return role!.id;
}

async function findUserByEmail(email: string) {
	const rows = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
	return rows[0] ?? null;
}

// ── Test setup ─────────────────────────────────────────────

let tester: RequestTester;

beforeAll(async () => {
	testRoleId = await seedRole();

	const { app } = createTestApp({
		db,
		mockAuthBridge: createMockAuthBridge(adminSession),
		routes: [userRoutesV1],
	});
	tester = new RequestTester(app);
});

afterAll(async () => {
	await truncateUsers();
});

beforeEach(async () => {
	await truncateUsers();
});

// ── Tests ──────────────────────────────────────────────────

describe("Integration (real DB): User CRUD", () => {
	it("POST /api/v1/users creates a user in the database", async () => {
		const res = await tester.post("/api/v1/users", {
			name: "Real User",
			email: "real-db@test.com",
			password: "password123",
			roleId: testRoleId,
			phone: "+1234567890",
		});

		expect(res.status).toBe(201);
		const body = res.body as { data: SafeUserOutput };
		expect(body.data.fullName).toBe("Real User");
		expect(body.data.emailAddress).toBe("real-db@test.com");

		// Verify it's actually in the DB
		const dbUser = await findUserByEmail("real-db@test.com");
		expect(dbUser).not.toBeNull();
		expect(dbUser!.name).toBe("Real User");
		expect(dbUser!.phone).toBe("+1234567890");
	});

	it("POST /api/v1/users with duplicate email returns 409", async () => {
		const payload = {
			name: "Dup User",
			email: "dup-db@test.com",
			password: "password123",
			roleId: testRoleId,
		};

		const first = await tester.post("/api/v1/users", payload);
		expect(first.status).toBe(201);

		const second = await tester.post("/api/v1/users", payload);
		expect(second.status).toBe(409);
	});

	it("GET /api/v1/users returns paginated list from DB", async () => {
		// Seed 3 users
		for (let i = 0; i < 3; i++) {
			await tester.post("/api/v1/users", {
				name: `List User ${i}`,
				email: `list-${i}@test.com`,
				password: "password123",
				roleId: testRoleId,
			});
		}

		const res = await tester.get("/api/v1/users", { token: "admin-token" });

		expect(res.status).toBe(200);
		const body = res.body as { data: SafeUserOutput[]; meta: { total: number } };
		expect(body.data.length).toBe(3);
		expect(body.meta.total).toBe(3);
	});

	it("GET /api/v1/users/:id returns user from DB", async () => {
		const createRes = await tester.post("/api/v1/users", {
			name: "Detail User",
			email: "detail-db@test.com",
			password: "password123",
			roleId: testRoleId,
		});
		const userId = (createRes.body as { data: SafeUserOutput }).data.id;

		const res = await tester.get(`/api/v1/users/${userId}`, { token: "admin-token" });

		expect(res.status).toBe(200);
		const body = res.body as { data: SafeUserOutput };
		expect(body.data.fullName).toBe("Detail User");
		expect(body.data.id).toBe(userId);
	});

	it("GET /api/v1/users/:id returns 404 for nonexistent user", async () => {
		const res = await tester.get("/api/v1/users/01999999-9999-7999-9999-999999999999", {
			token: "admin-token",
		});
		expect(res.status).toBe(404);
	});

	it("PATCH /api/v1/users/:id updates user in DB", async () => {
		const createRes = await tester.post("/api/v1/users", {
			name: "Before Update",
			email: "update-db@test.com",
			password: "password123",
			roleId: testRoleId,
		});
		const userId = (createRes.body as { data: SafeUserOutput }).data.id;

		const res = await tester.patch(
			`/api/v1/users/${userId}`,
			{ name: "After Update", phone: "+9999999999" },
			{ token: "admin-token" },
		);

		expect(res.status).toBe(200);
		const body = res.body as { data: SafeUserOutput };
		expect(body.data.fullName).toBe("After Update");
		expect(body.data.phone).toBe("+9999999999");

		// Verify in DB
		const dbUser = await findUserByEmail("update-db@test.com");
		expect(dbUser!.name).toBe("After Update");
		expect(dbUser!.phone).toBe("+9999999999");
	});

	it("DELETE /api/v1/users/:id removes user from DB", async () => {
		const createRes = await tester.post("/api/v1/users", {
			name: "Delete Me",
			email: "delete-db@test.com",
			password: "password123",
			roleId: testRoleId,
		});
		const userId = (createRes.body as { data: SafeUserOutput }).data.id;

		const delRes = await tester.delete(`/api/v1/users/${userId}`, { token: "admin-token" });
		expect(delRes.status).toBe(200);

		// Verify it's gone from DB
		const dbUser = await findUserByEmail("delete-db@test.com");
		expect(dbUser).toBeNull();
	});

	it("POST /api/v1/users with invalid email returns 422", async () => {
		const res = await tester.post("/api/v1/users", {
			name: "Bad Email",
			email: "not-an-email",
			password: "password123",
			roleId: testRoleId,
		});

		expect(res.status).toBe(422);
	});

	it("POST /api/v1/users with short password returns 422", async () => {
		const res = await tester.post("/api/v1/users", {
			name: "Short Pass",
			email: "short@test.com",
			password: "short",
			roleId: testRoleId,
		});

		expect(res.status).toBe(422);
	});
});

describe("Integration (real DB): RBAC enforcement", () => {
	it("GET /api/v1/users without token returns 403", async () => {
		const res = await tester.get("/api/v1/users");
		expect(res.status).toBe(403);
	});

	it("GET /api/v1/users with reader token succeeds (has user/read)", async () => {
		// Seed a user so the list isn't empty
		await tester.post("/api/v1/users", {
			name: "Seed",
			email: "rbac-seed@test.com",
			password: "password123",
			roleId: testRoleId,
		});

		// Use a tester with reader session
		const { app } = createTestApp({
			db,
			mockAuthBridge: createMockAuthBridge(readerSession),
			routes: [userRoutesV1],
		});
		const readerTester = new RequestTester(app);

		const res = await readerTester.get("/api/v1/users", { token: "reader-token" });
		expect(res.status).toBe(200);
	});

	it("PATCH /api/v1/users with reader token returns 403 (no user/update)", async () => {
		const { app } = createTestApp({
			db,
			mockAuthBridge: createMockAuthBridge(readerSession),
			routes: [userRoutesV1],
		});
		const readerTester = new RequestTester(app);

		const res = await readerTester.patch(
			"/api/v1/users/some-id",
			{ name: "Hack" },
			{ token: "reader-token" },
		);
		expect(res.status).toBe(403);
	});

	it("DELETE /api/v1/users with reader token returns 403", async () => {
		const { app } = createTestApp({
			db,
			mockAuthBridge: createMockAuthBridge(readerSession),
			routes: [userRoutesV1],
		});
		const readerTester = new RequestTester(app);

		const res = await readerTester.delete("/api/v1/users/some-id", { token: "reader-token" });
		expect(res.status).toBe(403);
	});
});
