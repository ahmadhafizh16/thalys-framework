# RBAC & Permissions

Thalys includes a role-based access control (RBAC) system with wildcard permission matching, declarative permission definitions, and a middleware factory that protects routes with a single line of code. Permissions are loaded on every authenticated request — there is no stale cache, so role changes take effect immediately.

## How it works under the hood

```txt
User registers / logs in
  │
  │  users.roleId → roles.id
  │               → role_permissions (resource, action)
  │
  ▼
GetUserPermissionsTask (JOIN on every session validation)
  │
  ▼
SessionDTO.permissions = [{ resource: "user", action: "read" }, ...]
  │
  ▼
can("user", "read") middleware
  │  hasPermission(userPermissions, { resource: "user", action: "read" })
  │
  ├─ match      → allow
  └─ no match   → throw ForbiddenError (403)
```

## The schema

RBAC uses two tables: `roles` and `role_permissions`. The `users` table has a `roleId` foreign key.

```ts
// src/Containers/Auth/Models/role.schema.ts
export const rolesTable = pgTable("roles", {
	id: text("id").primaryKey().$defaultFn(() => uuidv7()),
	name: text("name").notNull().unique(),
	description: text("description").notNull(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

```ts
// src/Containers/Auth/Models/permission.schema.ts
export const rolePermissionsTable = pgTable(
	"role_permissions",
	{
		id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
		roleId: uuid("role_id").notNull(),
		resource: text("resource").notNull(),
		action: text("action").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => ({
		roleResourceActionUnique: unique("role_resource_action_unique").on(
			t.roleId,
			t.resource,
			t.action,
		),
	}),
);
```

```ts
// src/Containers/User/Models/user.schema.ts (roleId column)
export const usersTable = pgTable("users", {
	id: text("id").primaryKey().$defaultFn(() => uuidv7()),
	// ...
	roleId: uuid("role_id"),
	// ...
});
```

The `role_permissions` table has a unique constraint on `(roleId, resource, action)` — a role can't have duplicate permissions for the same resource/action pair.

## Permission shape

A permission is a pair of strings: `resource` and `action`.

| Permission | resource | action | Meaning |
| --- | --- | --- | --- |
| `user/read` | `user` | `read` | View user profiles |
| `user/create` | `user` | `create` | Create new users |
| `product/update` | `product` | `update` | Edit products |
| `user/*` | `user` | `*` | All actions on users |
| `*/*` | `*` | `*` | All actions on all resources (admin) |

Wildcards work at both the resource and action level. `user/*` grants all actions on the `user` resource; `*/*` grants everything.

## The permission registry

Thalys ships with a declarative registry of known permissions. This is documentation-as-code — it doesn't enforce anything at runtime, but it provides a single source of truth for what permissions exist in the system:

```ts
// src/Ship/Auth/permissionRegistry.ts
export interface PermissionDefinition {
	resource: string;
	action: string;
	description: string;
}

export const PERMISSIONS: readonly PermissionDefinition[] = [
	{ resource: "user", action: "create", description: "Create new users" },
	{ resource: "user", action: "read", description: "View user profiles" },
	{ resource: "user", action: "update", description: "Edit user profiles" },
	{ resource: "user", action: "delete", description: "Delete users" },
	{ resource: "product", action: "create", description: "Create products" },
	{ resource: "product", action: "read", description: "View products" },
	{ resource: "product", action: "update", description: "Edit products" },
	{ resource: "order", action: "read", description: "View orders" },
	{ resource: "order", action: "update", description: "Update order status" },
];
```

::: tip Extend the registry when you add resources
When you scaffold a new container with `thalys:make:container Product --crud`, add the product permissions to this registry. It keeps the permission set discoverable and helps with generating seed data or admin UIs.
:::

## hasPermission() with wildcard support

The core permission check is a pure function that supports wildcards:

```ts
// src/Ship/Http/permissionCheck.ts
export function hasPermission(
	userPermissions: { resource: string; action: string }[],
	required: { resource: string; action: string },
): boolean {
	return userPermissions.some((p) => {
		if (p.resource === required.resource && p.action === required.action) return true;
		if (p.resource === "*" && p.action === required.action) return true;
		if (p.resource === required.resource && p.action === "*") return true;
		if (p.resource === "*" && p.action === "*") return true;
		return false;
	});
}
```

Four match cases:
1. **Exact match** — `user/read` satisfies `user/read`
2. **Wildcard resource** — `*/read` satisfies `user/read`
3. **Wildcard action** — `user/*` satisfies `user/read`
4. **Full wildcard** — `*/*` satisfies anything

## The can() middleware factory

`can(resource, action)` returns a `beforeHandle` function that checks `ctx.currentUser`. If there is no session, it throws `401`. If the session lacks the required permission, it throws `403`:

```ts
// src/Ship/Http/canMiddleware.ts
export class ForbiddenError extends AppError {
	constructor(message = "You do not have permission to perform this action.") {
		super(403, "FORBIDDEN", message);
	}
}

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

The `AuthedContext` interface is widened to `AuthedContext & Record<string, unknown>` for Elysia type compatibility. The `can()` guard is still used in `beforeHandle` arrays exactly as before.

Attach it to any route via `beforeHandle` — the handler delegates to a controller function:

```ts
.get(
	"/",
	async ({ container, query }) => listUsers(query, container as Container),
	{
		beforeHandle: [can("user", "read")],
	},
)
```

You can chain multiple middleware in the array:

```ts
{
	beforeHandle: [can("user", "read"), someOtherMiddleware],
}
```

## How permissions load

Permissions are loaded by `GetUserPermissionsTask` on every session validation. The task JOINs `role_permissions` to `users` on `roleId`:

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

This task is called by `InProcessAuthBridgeAdapter.validateToken()` — so every request that carries a bearer token triggers this query. The result is attached to `SessionDTO.permissions[]`:

```ts
// In InProcessAuthBridgeAdapter.validateToken():
const authSession = await this.validateTokenAction.execute(token);
if (!authSession) return null;

let permissions: PermissionEntry[] = [];
try {
	permissions = await this.getUserPermissionsTask.run(authSession.userId);
} catch {
	// User may not have a role yet — no permissions
}

return {
	...authSession,
	permissions,
};
```

::: tip Why query on every request?
Loading permissions on every request ensures that role changes (promoting a user to admin, revoking access) take effect immediately — the user doesn't need to re-login. The query is a single indexed JOIN, so the overhead is minimal (sub-millisecond on a warm connection). If this becomes a bottleneck at extreme scale, cache the result in `CacheStore` with a short TTL (e.g. 60 seconds) and invalidate on role assignment.
:::

## Seeding roles

The `db:seed:roles` command creates three default roles with their permissions:

```bash
bun run command db:seed:roles
```

| Role | Permissions | Description |
| --- | --- | --- |
| `admin` | `*/*` | Full administrative access |
| `customer` | `profile/read`, `profile/update`, `order/read` | Default shopper account |
| `seller` | `product/create`, `product/read`, `product/update`, `order/read`, `order/update` | Merchant account |

The seeder is idempotent — it checks for existing roles before inserting and skips permissions that already exist:

```ts
// src/Containers/Auth/UI/Command/SeedRolesCommand.ts
const DEFAULT_ROLES = [
	{ name: "admin", description: "Full administrative access." },
	{ name: "customer", description: "Default shopper account." },
	{ name: "seller", description: "Merchant account that manages catalog and orders." },
];

const DEFAULT_PERMISSIONS = {
	admin: [{ resource: "*", action: "*" }],
	customer: [
		{ resource: "profile", action: "read" },
		{ resource: "profile", action: "update" },
		{ resource: "order", action: "read" },
	],
	seller: [
		{ resource: "product", action: "create" },
		{ resource: "product", action: "read" },
		{ resource: "product", action: "update" },
		{ resource: "order", action: "read" },
		{ resource: "order", action: "update" },
	],
};
```

::: warning Newly registered users have no role
The `RegisterAction` creates a Better Auth user but does not assign a role. The user's `roleId` is `null`, so `GetUserPermissionsTask` returns an empty array. To assign a role, update the `users.roleId` column:

```sql
UPDATE users SET role_id = '<role-uuid>' WHERE id = '<user-uuid>';
```

Or do it in code:

```ts
await db.update(usersTable).set({ roleId }).where(eq(usersTable.id, userId));
```

Until a role is assigned, the user can only access routes with no `can()` check (like `POST /api/v1/auth/register`).
:::

## Protecting routes

Every protected route uses `can()` in its `beforeHandle`. Route files are thin wiring — they use `routeGroup()` (which internally mounts `shipContext` + `authContext` + rate limiting) and delegate to controller functions. Here's the full pattern from the `User` container:

```ts
import { createUser } from "@containers/User/UI/API/Controllers/createUser";
import { deleteUser } from "@containers/User/UI/API/Controllers/deleteUser";
import { getUser } from "@containers/User/UI/API/Controllers/getUser";
import { listUsers } from "@containers/User/UI/API/Controllers/listUsers";
import { updateUser } from "@containers/User/UI/API/Controllers/updateUser";
import type { Container } from "@ship/Container/Container";
import { can } from "@ship/Http/canMiddleware";
import { routeGroup } from "@ship/Http/routeGroup";

export const userRoutesV1 = routeGroup("/v1/users")
	// Create — open to anyone
	.post("/", async ({ container, body, set }) => {
		set.status = 201;
		return createUser(body, container as Container);
	}, { body: CreateUserRequest })
	// List — requires auth + user/read
	.get("/", async ({ container, query }) => listUsers(query, container as Container), {
		beforeHandle: [can("user", "read")],
	})
	// Detail — requires auth + user/read
	.get("/:id", async ({ container, params }) => getUser(params, container as Container), {
		beforeHandle: [can("user", "read")],
	})
	// Update — requires auth + user/update
	.patch("/:id", async ({ container, params, body }) => updateUser(params, body, container as Container), {
		beforeHandle: [can("user", "update")],
	})
	// Delete — requires auth + user/delete
	.delete("/:id", async ({ container, params }) => deleteUser(params, container as Container), {
		beforeHandle: [can("user", "delete")],
	})
```

The `routeGroup()` helper mounts `authContext` internally (via the default `"api"` preset) — it's what derives `ctx.currentUser` from the bearer token. Without it, `can()` will always throw `401` because `currentUser` is `undefined`.

## Extension: policy classes

For complex authorization logic that goes beyond resource/action matching (e.g. "a user can only edit their own profile", "a seller can only update products in their own store"), implement a policy class:

```ts
export class UserPolicy {
	canUpdate(currentUser: SessionDTO, targetUserId: string): boolean {
		// Admins can update anyone
		if (hasPermission(currentUser.permissions, { resource: "user", action: "update" })) {
			return true;
		}
		// Users can update themselves
		return currentUser.userId === targetUserId;
	}
}
```

Use it inside a controller function:

```ts
// src/Containers/User/UI/API/Controllers/updateUser.ts
import { UpdateUserAction, type UpdateUserInput } from "@containers/User/Actions/UpdateUserAction";
import type { UpdateUserDTO } from "@containers/User/Requests/update-user.request";
import { UserTransformer } from "@containers/User/Transformers/UserTransformer";
import type { Container } from "@ship/Container/Container";
import { BaseRequest } from "@ship/Http/BaseRequest";
import { ForbiddenError } from "@ship/Http/canMiddleware";
import { wrapResponse } from "@ship/Http/MainController";
import type { SessionDTO } from "@containers/AuthBridge/DTOs/AuthBridgeDTO";
import { UserPolicy } from "@containers/User/Policies/UserPolicy";

const transformer = new UserTransformer();

export async function updateUser(
	params: { id: string },
	body: UpdateUserDTO,
	container: Container,
	currentUser?: SessionDTO,
) {
	const policy = new UserPolicy();
	if (!policy.canUpdate(currentUser!, params.id)) {
		throw new ForbiddenError("You can only update your own profile.");
	}

	const id = BaseRequest.validateId(params.id);
	const input: UpdateUserInput = { id, ...body };
	const action = container.make(UpdateUserAction);
	const updated = await action.execute(input);
	return wrapResponse(transformer.transform(updated));
}
```

The route passes `currentUser` through to the controller:

```ts
.patch(
	"/:id",
	async ({ container, params, body, currentUser }) =>
		updateUser(params, body, container as Container, currentUser),
	{ body: UpdateUserRequest, beforeHandle: [can("user", "update")] },
)
```

Policies keep the authorization logic co-located with the domain it protects, and they're easy to unit test in isolation. Register them in the container if they need dependencies (e.g. a repository for ownership checks).
