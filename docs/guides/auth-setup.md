# Auth Setup

Thalys ships with a complete authentication system built on [Better Auth](https://www.better-auth.com), but you will never import Better Auth directly from your business code. The entire auth subsystem — session validation, login, registration, logout, permission loading — lives behind the `AuthBridgePort` interface. This guide walks through how it fits together, how to wire social auth, and how to protect routes with the `can()` middleware.

## How it works under the hood

Better Auth is configured once in the `Auth` container and wrapped in a set of Tasks. Those Tasks are wrapped in Actions. The Actions are wrapped by the `AuthBridge` container's adapter, which exposes a clean port interface. Ship middleware (and your route handlers) talk to the port — never to Better Auth directly.

```txt
Request ──► Authorization: Bearer <token>
  │
  ▼
authContext (Elysia derive)
  │  container.make("AuthBridgePort")
  ▼
InProcessAuthBridgeAdapter
  ├── ValidateTokenAction → ValidateTokenTask → betterAuth.api.getSession()
  └── GetUserPermissionsTask → JOIN role_permissions ⨝ users
  │
  ▼
ctx.currentUser = SessionDTO { userId, email, name, sessionId, expiresAt, permissions[] }
```

The `SessionDTO` that lands on `ctx.currentUser` carries the user's permissions on every validated session. That is what the `can()` middleware checks against.

## The Better Auth configuration

Better Auth is initialised in `src/Containers/Auth/betterAuth.config.ts`. It uses the Drizzle adapter against your existing Postgres tables, enables email-and-password auth, and mounts the `bearer()` plugin so sessions can be validated from an `Authorization: Bearer <token>` header.

```ts
// src/Containers/Auth/betterAuth.config.ts
import { db } from "@ship/database/connection";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";

import { accountsTable } from "@containers/Auth/Models/account.schema";
import { sessionsTable } from "@containers/Auth/Models/session.schema";
import { verificationsTable } from "@containers/Auth/Models/verification.schema";
import { usersTable } from "@containers/User/Models/user.schema";

const schema = {
	users: usersTable,
	sessions: sessionsTable,
	accounts: accountsTable,
	verifications: verificationsTable,
};

export const auth = betterAuth({
	baseURL: process.env.APP_URL ?? "http://localhost:3000",
	database: drizzleAdapter(db, { provider: "pg", schema, usePlural: true }),
	emailAndPassword: {
		enabled: true,
	},
	plugins: [bearer()],
	session: {
		expiresIn: 60 * 60 * 24 * 7, // 7 days
		updateAge: 60 * 60 * 24, // refresh every day
	},
});
```

::: tip The bearer() plugin
Without `bearer()`, Better Auth expects sessions to be read from cookies. The plugin adds support for validating a session from a raw bearer token via `getSession({ headers })`. This is what makes the API token flow work — the client sends `Authorization: Bearer <token>` and every downstream Task constructs a `Headers` object from it.
:::

### Social auth (Google / GitHub)

Social providers are configured conditionally — they only activate when their environment variables are present. This means you can commit the config without credentials and enable social auth per-environment.

```ts
socialProviders: {
	google: process.env.GOOGLE_CLIENT_ID
		? {
				clientId: process.env.GOOGLE_CLIENT_ID,
				clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
			}
		: undefined,
	github: process.env.GITHUB_CLIENT_ID
		? {
				clientId: process.env.GITHUB_CLIENT_ID,
				clientSecret: process.env.GITHUB_CLIENT_SECRET!,
			}
		: undefined,
},
```

To enable Google OAuth, add to your `.env`:

```bash
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
```

GitHub uses `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`. When the env vars are absent, the provider is `undefined` and Better Auth simply skips it.

## The Auth container structure

The `Auth` container follows the Porto layering. Each auth operation is a Task that calls one Better Auth API method, wrapped in an Action that provides the transactional boundary and DI.

### Tasks

```ts
// src/Containers/Auth/Tasks/LoginTask.ts
export class LoginTask {
	constructor(private readonly authInstance: typeof auth) {}

	async run(input: LoginInput): Promise<{ session: AuthSessionDTO; token: string }> {
		const result = await this.authInstance.api.signInEmail({
			body: { email: input.email, password: input.password },
		});

		if (!result || !result.token) {
			throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
		}

		const sessionResult = await this.authInstance.api.getSession({
			headers: new Headers({ Authorization: `Bearer ${result.token}` }),
		});

		if (!sessionResult) {
			throw new AppError(401, "INVALID_CREDENTIALS", "Session could not be established.");
		}

		const session: AuthSessionDTO = {
			userId: sessionResult.user.id,
			email: sessionResult.user.email,
			name: sessionResult.user.name,
			sessionId: sessionResult.session.id,
			expiresAt: sessionResult.session.expiresAt.getTime(),
		};
		return { session, token: result.token };
	}
}
```

There are four Tasks, each doing exactly one thing:

| Task | Better Auth method | Purpose |
| --- | --- | --- |
| `RegisterTask` | `api.signUpEmail` | Create a user account, return token + session |
| `LoginTask` | `api.signInEmail` | Validate credentials, return token + session |
| `ValidateTokenTask` | `api.getSession` | Validate a bearer token, return session or `null` |
| `LogoutTask` | `api.revokeSession` | Revoke the session (best-effort, never throws) |

`ValidateTokenTask` returns `null` (not an error) when the token is invalid or expired. This lets the middleware treat "no session" uniformly:

```ts
// src/Containers/Auth/Tasks/ValidateTokenTask.ts
async run(token: string): Promise<AuthSessionDTO | null> {
	try {
		const result = await this.authInstance.api.getSession({
			headers: new Headers({ Authorization: `Bearer ${token}` }),
		});

		if (!result) return null;

		return {
			userId: result.user.id,
			email: result.user.email,
			name: result.user.name,
			sessionId: result.session.id,
			expiresAt: result.session.expiresAt.getTime(),
		};
	} catch {
		return null;
	}
}
```

### Actions

Each Action wraps its Task and accepts the DB client via constructor injection (resolved by the DI container):

```ts
// src/Containers/Auth/Actions/LoginAction.ts
export class LoginAction extends BaseAction {
	constructor(
		db: AppDB,
		private readonly loginTask: LoginTask,
	) {
		super(db);
	}

	async execute(input: LoginInput): Promise<{ session: AuthSessionDTO; token: string }> {
		return await this.loginTask.run(input);
	}
}
```

The other Actions (`RegisterAction`, `ValidateTokenAction`, `LogoutAction`) follow the same shape — they delegate to their Task.

## Loading permissions: GetUserPermissionsTask

The `SessionDTO` includes a `permissions[]` array. This is populated by `GetUserPermissionsTask`, which JOINs the `role_permissions` table to the `users` table on `roleId`:

```ts
// src/Containers/Auth/Tasks/GetUserPermissionsTask.ts
export class GetUserPermissionsTask {
	constructor(private readonly dbClient: AppClient) {}

	async run(userId: string): Promise<PermissionEntry[]> {
		const rows = await this.dbClient
			.select({
				resource: rolePermissionsTable.resource,
				action: rolePermissionsTable.action,
			})
			.from(rolePermissionsTable)
			.innerJoin(usersTable, eq(usersTable.roleId, rolePermissionsTable.roleId))
			.where(eq(usersTable.id, userId));

		return rows;
	}
}
```

::: warning Permissions load on every session validation
`GetUserPermissionsTask` runs on every request that carries a bearer token. This is intentional — it ensures permission changes (e.g. assigning a new role) take effect immediately without requiring the user to re-login. The query is a single indexed JOIN, so the cost is negligible. If this becomes a bottleneck, you can cache the result in the `CacheStore` with a short TTL and invalidate on role assignment.
:::

## The AuthBridge container

The `AuthBridge` container is the anti-corruption layer between Better Auth and the rest of your application. It defines a port interface and an in-process adapter.

### DTOs

```ts
// src/Containers/AuthBridge/DTOs/AuthBridgeDTO.ts
export interface PermissionEntry {
	resource: string;
	action: string;
}

export interface SessionDTO {
	userId: string;
	email: string;
	name: string;
	sessionId: string;
	expiresAt: number;
	permissions: PermissionEntry[];
}
```

The `SessionDTO` is deliberately flat and serializable. It does not expose the Better Auth session object or the user table schema.

### The port + adapter

```ts
// src/Containers/AuthBridge/Adapters/InProcessAuthBridgeAdapter.ts
export interface AuthBridgePort {
	validateToken(token: string): Promise<SessionDTO | null>;
	logout(sessionToken: string): Promise<void>;
}

export class InProcessAuthBridgeAdapter implements AuthBridgePort {
	constructor(
		private readonly validateTokenAction: ValidateTokenAction,
		private readonly logoutAction: LogoutAction,
		private readonly getUserPermissionsTask: GetUserPermissionsTask,
	) {}

	async validateToken(token: string): Promise<SessionDTO | null> {
		const authSession = await this.validateTokenAction.execute(token);
		if (!authSession) return null;

		let permissions: PermissionEntry[] = [];
		try {
			permissions = await this.getUserPermissionsTask.run(authSession.userId);
		} catch {
			// User may not have a role yet — no permissions
		}

		return {
			userId: authSession.userId,
			email: authSession.email,
			name: authSession.name,
			sessionId: authSession.sessionId,
			expiresAt: authSession.expiresAt,
			permissions,
		};
	}

	async logout(sessionToken: string): Promise<void> {
		await this.logoutAction.execute(sessionToken);
	}
}
```

Notice that `validateToken` calls the `ValidateTokenAction` (which returns an `AuthSessionDTO` without permissions) and then enriches it with permissions via `GetUserPermissionsTask`. The permission lookup is wrapped in a try/catch — if the user has no role yet, they get an empty permissions array rather than an error.

### Container registration

The adapter is registered as the `AuthBridgePort` binding in the DI container:

```ts
// src/Ship/Container/registerServices.ts
container.bind(
	InProcessAuthBridgeAdapter,
	ValidateTokenAction,
	LogoutAction,
	GetUserPermissionsTask,
);
container.set("AuthBridgePort", container.make(InProcessAuthBridgeAdapter));
```

Everything that needs auth resolves `"AuthBridgePort"` from the container — it never imports the adapter class directly.

## Routes

The auth routes are mounted at `/api/v1/auth` and rate-limited with the `auth` preset (5 requests per minute). Because login and register don't require an existing session, the route group uses `routeGroup("/v1/auth", "auth")` — the `"auth"` preset skips `authContext` (which derives `currentUser`) and applies the stricter rate limit.

Route files are thin wiring — they import controller functions and delegate. Each controller is a plain `async function` that takes typed input + a `Container`, calls the relevant Action, and returns `wrapResponse(...)`:

```ts
// src/Containers/Auth/UI/API/Controllers/register.ts
import { RegisterAction } from "@containers/Auth/Actions/RegisterAction";
import type { RegisterDTO } from "@containers/Auth/Requests/register.request";
import type { Container } from "@ship/Container/Container";
import { wrapResponse } from "@ship/Http/MainController";

export async function register(body: RegisterDTO, container: Container) {
	const action = container.make(RegisterAction);
	const result = await action.execute(body);
	return wrapResponse(result);
}
```

```ts
// src/Containers/Auth/UI/API/Controllers/login.ts
import { LoginAction } from "@containers/Auth/Actions/LoginAction";
import type { LoginDTO } from "@containers/Auth/Requests/login.request";
import type { Container } from "@ship/Container/Container";
import { wrapResponse } from "@ship/Http/MainController";

export async function login(body: LoginDTO, container: Container) {
	const action = container.make(LoginAction);
	const result = await action.execute(body);
	return wrapResponse(result);
}
```

```ts
// src/Containers/Auth/UI/API/Controllers/logout.ts
import { LogoutAction } from "@containers/Auth/Actions/LogoutAction";
import type { Container } from "@ship/Container/Container";
import { AppError } from "@ship/Exceptions/AppError";
import { wrapResponse } from "@ship/Http/MainController";
import { extractToken } from "@ship/Http/authMiddleware";

export async function logout(request: Request, container: Container) {
	const token = extractToken(request);
	if (!token) throw new AppError(401, "UNAUTHORIZED", "No session token provided.");
	const action = container.make(LogoutAction);
	await action.execute(token);
	return wrapResponse({ success: true });
}
```

The routes file wires them together:

```ts
// src/Containers/Auth/UI/API/v1/routes.ts
import { LoginRequest } from "@containers/Auth/Requests/login.request";
import { RegisterRequest } from "@containers/Auth/Requests/register.request";
import { login } from "@containers/Auth/UI/API/Controllers/login";
import { logout } from "@containers/Auth/UI/API/Controllers/logout";
import { register } from "@containers/Auth/UI/API/Controllers/register";
import type { Container } from "@ship/Container/Container";
import { routeGroup } from "@ship/Http/routeGroup";

export const authRoutesV1 = routeGroup("/v1/auth", "auth")
	.post("/register", async ({ container, body }) => register(body, container as Container), {
		body: RegisterRequest,
	})
	.post("/login", async ({ container, body }) => login(body, container as Container), {
		body: LoginRequest,
	})
	.post("/logout", async ({ request, container }) => logout(request, container as Container));
```

| Method | Path | Auth | Rate limit | Description |
| --- | --- | --- | --- | --- |
| POST | `/api/v1/auth/register` | None | 5/min | Create account, return token + session |
| POST | `/api/v1/auth/login` | None | 5/min | Validate credentials, return token + session |
| POST | `/api/v1/auth/logout` | Bearer token | 5/min | Revoke the session |

All three return the standard response envelope `{ data, meta }`. Register and login return `{ data: { session, token } }`.

### Trying it with curl

```bash
# Register
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Ada Lovelace","email":"ada@example.com","password":"password123"}'

# Login
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ada@example.com","password":"password123"}'

# Logout (use the token from register/login)
curl -X POST http://localhost:3000/api/v1/auth/logout \
  -H "Authorization: Bearer <token>"
```

## How authContext derives currentUser

The `authContext` plugin is an Elysia `.derive()` hook that runs on every request to a route group that uses it. It extracts the bearer token, validates it through the `AuthBridgePort`, and injects the resulting `SessionDTO` as `ctx.currentUser`.

```ts
// src/Ship/Http/authContext.ts
export const authContext = new Elysia({ name: "auth-context" }).derive(
	{ as: "scoped" },
	async (ctx) => {
		const token = extractToken(ctx.request);
		if (!token) return { currentUser: undefined as SessionDTO | undefined };

		const container = (ctx as unknown as { container: Container }).container;
		const authBridge = container.make<AuthBridgePort>("AuthBridgePort");
		const session = await authBridge.validateToken(token);
		return { currentUser: session ?? (undefined as SessionDTO | undefined) };
	},
);
```

The token is extracted from either the `Authorization: Bearer <token>` header or a `session_token` cookie:

```ts
// src/Ship/Http/authMiddleware.ts
export function extractToken(request: Request): string | null {
	const authHeader = request.headers.get("authorization");
	if (authHeader?.startsWith("Bearer ")) {
		return authHeader.slice(7);
	}
	const cookies = request.headers.get("cookie");
	if (cookies) {
		const match = cookies.match(/session_token=([^;]+)/);
		if (match) return match[1]!;
	}
	return null;
}
```

::: tip authContext is scoped, not global
`authContext` uses `{ as: "scoped" }` because it should only run for route groups that need authentication. You don't import or mount `authContext` directly in route files — `routeGroup()` does it for you. The default `"api"` preset includes `authContext`; the `"auth"` preset skips it (for login/register routes that handle tokens explicitly).
:::

## Protecting routes with can()

The `can()` middleware factory checks whether `ctx.currentUser` has a specific permission. If there is no session, it throws `401`. If the session exists but lacks the permission, it throws `403`.

```ts
// src/Ship/Http/canMiddleware.ts
export function can(resource: string, action: string) {
	return (ctx: AuthedContext & Record<string, unknown>) => {
		if (!ctx.currentUser) {
			throw new ForbiddenError("Authentication required.");
		}

		const userPermissions = ctx.currentUser.permissions ?? [];
		if (!hasPermission(userPermissions, { resource, action })) {
			throw new ForbiddenError();
		}
	};
}
```

The `AuthedContext` interface is widened to `AuthedContext & Record<string, unknown>` for Elysia type compatibility — the `can()` guard still works exactly the same in `beforeHandle` arrays.

Attach it to a route via `beforeHandle` — the handler delegates to a controller function:

```ts
.get(
	"/",
	async ({ container, query }) => listUsers(query, container as Container),
	{
		beforeHandle: [can("user", "read")],
	},
)
```

See the [RBAC & Permissions guide](./rbac) for the full permission system, including wildcard support and the permission registry.

## Extension: swapping the adapter for a microservice

The `AuthBridgePort` interface is the seam. Today the adapter calls Better Auth in-process; tomorrow you might run auth as a separate microservice. To switch, implement the port with HTTP calls and rebind it in the container:

```ts
import type { AuthBridgePort } from "@containers/AuthBridge/Adapters/InProcessAuthBridgeAdapter";

export class HttpAuthBridgeAdapter implements AuthBridgePort {
	constructor(private readonly authServiceUrl: string) {}

	async validateToken(token: string) {
		const res = await fetch(`${this.authServiceUrl}/validate`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!res.ok) return null;
		return (await res.json()) as SessionDTO;
	}

	async logout(sessionToken: string): Promise<void> {
		await fetch(`${this.authServiceUrl}/logout`, {
			method: "POST",
			headers: { Authorization: `Bearer ${sessionToken}` },
		});
	}
}
```

Register it in the container:

```ts
container.set("AuthBridgePort", new HttpAuthBridgeAdapter(process.env.AUTH_SERVICE_URL!));
```

No route handler, middleware, or Action changes. The `can()` middleware, `authContext`, and every consumer continues to work against the same `SessionDTO` contract.
