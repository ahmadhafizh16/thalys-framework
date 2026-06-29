import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { rolePermissionsTable } from "@containers/Auth/Models/permission.schema";
import { rolesTable } from "@containers/Auth/Models/role.schema";
import { authRoutesV1 } from "@containers/Auth/UI/API/v1/routes";
import { usersTable } from "@containers/User/Models/user.schema";
import { userRoutesV1 } from "@containers/User/UI/API/v1/routes";
import { InMemoryRateLimitStore } from "@ship/Http/InMemoryRateLimitStore";
import type { RateLimitStore } from "@ship/Http/RateLimiter";
import { authContext } from "@ship/Http/authContext";
import { RequestTester } from "@ship/TestHelpers/RequestTester";
import { db } from "@ship/database/connection";
import { container } from "@ship/setup";
import { shipContext } from "@ship/setup";
import { eq, sql } from "drizzle-orm";
import { Elysia } from "elysia";

interface AuthResponse {
	data: {
		session: {
			userId: string;
			email: string;
			name: string;
			sessionId: string;
			expiresAt: number;
		};
		token: string;
	};
}

let testRoleId: string;
let tester: RequestTester;

function buildTestApp() {
	// Override the real container's rateLimitStore with a fresh one
	// so tests don't hit the auth preset (5/min) limit
	const freshStore = new InMemoryRateLimitStore();
	container.set<RateLimitStore>("rateLimitStore", freshStore);

	return new Elysia({ prefix: "/api" })
		.use(shipContext)
		.use(authContext)
		.use(authRoutesV1)
		.use(userRoutesV1);
}

async function truncateAuthTables() {
	await db.execute(sql`TRUNCATE TABLE users CASCADE`);
	await db.execute(sql`TRUNCATE TABLE sessions CASCADE`);
	await db.execute(sql`TRUNCATE TABLE accounts CASCADE`);
	await db.execute(sql`TRUNCATE TABLE verifications CASCADE`);
}

async function seedAdminRole(): Promise<string> {
	const existing = await db.select().from(rolesTable).where(eq(rolesTable.name, "admin")).limit(1);
	if (existing.length > 0) return existing[0]!.id;

	const [role] = await db
		.insert(rolesTable)
		.values({ name: "admin", description: "Full administrative access." })
		.returning();

	await db.insert(rolePermissionsTable).values({
		roleId: role!.id,
		resource: "*",
		action: "*",
	});

	return role!.id;
}

async function assignRoleToUser(userId: string, roleId: string) {
	await db.update(usersTable).set({ roleId }).where(eq(usersTable.id, userId));
}

beforeAll(async () => {
	testRoleId = await seedAdminRole();
	tester = new RequestTester(buildTestApp());
});

afterAll(async () => {
	await truncateAuthTables();
});

beforeEach(async () => {
	await truncateAuthTables();
	// Reset rate limit store between tests
	container.set<RateLimitStore>("rateLimitStore", new InMemoryRateLimitStore());
});

describe("Integration (real DB): Auth flow", () => {
	it("register → use token → logout → token revoked", async () => {
		// 1. Register a new user
		const regRes = await tester.post("/api/v1/auth/register", {
			name: "Auth Flow User",
			email: "authflow@test.com",
			password: "password123",
		});

		expect(regRes.status).toBe(200);
		const regBody = regRes.body as AuthResponse;
		expect(regBody.data.token).toBeTruthy();
		expect(regBody.data.session.userId).toBeTruthy();
		expect(regBody.data.session.email).toBe("authflow@test.com");
		expect(regBody.data.session.sessionId).not.toBe(regBody.data.session.userId);

		const token = regBody.data.token;
		const userId = regBody.data.session.userId;

		// 2. Try to access protected route — should get 403 (no role, no permissions)
		const deniedRes = await tester.get("/api/v1/users", { token });
		expect(deniedRes.status).toBe(403);

		// 3. Assign admin role directly in DB
		await assignRoleToUser(userId, testRoleId);

		// 4. Now the token should work (permissions loaded via JOIN)
		const allowedRes = await tester.get("/api/v1/users", { token });
		expect(allowedRes.status).toBe(200);

		// 5. Logout
		const logoutRes = await tester.post("/api/v1/auth/logout", undefined, { token });
		expect(logoutRes.status).toBe(200);

		// 6. Token should now be revoked — session no longer valid
		const revokedRes = await tester.get("/api/v1/users", { token });
		expect(revokedRes.status).toBe(403);
	});

	it("login with correct credentials returns valid token", async () => {
		// Register first
		await tester.post("/api/v1/auth/register", {
			name: "Login Test",
			email: "logintest@test.com",
			password: "password123",
		});

		// Login
		const loginRes = await tester.post("/api/v1/auth/login", {
			email: "logintest@test.com",
			password: "password123",
		});

		expect(loginRes.status).toBe(200);
		const loginBody = loginRes.body as AuthResponse;
		expect(loginBody.data.token).toBeTruthy();
		expect(loginBody.data.session.email).toBe("logintest@test.com");
		expect(loginBody.data.session.sessionId).not.toBe(loginBody.data.session.userId);
	});

	it("login with wrong password returns 401", async () => {
		await tester.post("/api/v1/auth/register", {
			name: "Wrong Pass",
			email: "wrongpass@test.com",
			password: "password123",
		});

		const res = await tester.post("/api/v1/auth/login", {
			email: "wrongpass@test.com",
			password: "wrongpassword",
		});

		expect(res.status).toBe(401);
	});

	it("login with nonexistent email returns 401", async () => {
		const res = await tester.post("/api/v1/auth/login", {
			email: "nonexistent@test.com",
			password: "password123",
		});

		expect(res.status).toBe(401);
	});

	it("logout without token returns 401", async () => {
		const res = await tester.post("/api/v1/auth/logout");
		expect(res.status).toBe(401);
	});

	it("register with duplicate email fails", async () => {
		const payload = {
			name: "Dup Email",
			email: "dupemail@test.com",
			password: "password123",
		};

		const first = await tester.post("/api/v1/auth/register", payload);
		expect(first.status).toBe(200);

		const second = await tester.post("/api/v1/auth/register", payload);
		expect(second.status).not.toBe(200);
	});
});
