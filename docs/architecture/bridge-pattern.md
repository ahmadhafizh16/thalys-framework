# Bridge Pattern

Containers in Thalys are isolated. A `User` container cannot import an `Auth` container's Tasks, Models, or Actions directly. But real applications need cross-domain communication — the auth middleware needs to validate tokens, an order placement needs to check product stock, a user creation needs to assign a role. The Bridge pattern is how Thalys makes that possible without breaking isolation.

## The problem

Imagine the auth middleware needs to validate a session token. The validation logic lives in the `Auth` container's `ValidateTokenAction`. Without a Bridge, the middleware would do this:

```ts
// ❌ Bad — Ship middleware importing a container's Action directly
import { ValidateTokenAction } from "@containers/Auth/Actions/ValidateTokenAction";

const session = await ValidateTokenAction.execute(token);
```

This violates the [Ship never imports from Containers](./ship-vs-containers#the-hard-rule-ship-never-imports-from-containers) rule. But even between two containers, the problem is the same:

```ts
// ❌ Bad — Order container importing Product's Task directly
import { StockTask } from "@containers/Product/Tasks/StockTask";

const stock = await StockTask.run(productId);
```

Both cases create a **hidden coupling**: the consumer knows about the producer's internal implementation. If `Auth` refactors `ValidateTokenAction` into two Actions, every consumer breaks. If `Product` changes its stock table schema, `Order` breaks.

## The solution: Bridge containers

A Bridge container sits between the producer and the consumer. It holds:

1. **DTOs** — flat, serializable data shapes that represent *what the consumer needs*, not the producer's internal types.
2. **A Port interface** — the contract: a set of methods the consumer can call.
3. **An Adapter** — the concrete implementation that calls the producer's **Actions** (never its Tasks or Models) and maps the result to the Bridge DTOs.

```txt
Containers/
  Auth/                              # producer — owns auth logic
    Actions/
      ValidateTokenAction.ts
      LogoutAction.ts
    Tasks/
      ValidateTokenTask.ts
      GetUserPermissionsTask.ts
  AuthBridge/                        # bridge — the external contract
    DTOs/
      AuthBridgeDTO.ts               # SessionDTO, PermissionEntry
    Adapters/
      InProcessAuthBridgeAdapter.ts  # AuthBridgePort interface + adapter
  User/                              # consumer — uses the Bridge, not Auth's internals
```

### Example: AuthBridge

The `AuthBridge` container exposes two operations that consumers (and Ship middleware) need: `validateToken` and `logout`.

**The DTO** — only the data the consumer needs, not the producer's internal types:

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

::: tip DTOs are the anti-corruption layer
The `SessionDTO` is deliberately flat and serializable. It does not expose the Better Auth session object, the user table schema, or any internal type. If the producer changes its internal representation, only the Adapter needs updating — every consumer continues to receive the same `SessionDTO`.
:::

**The Port interface + Adapter** — the contract and the in-process implementation:

```ts
// src/Containers/AuthBridge/Adapters/InProcessAuthBridgeAdapter.ts
import type { LogoutAction } from "@containers/Auth/Actions/LogoutAction";
import type { ValidateTokenAction } from "@containers/Auth/Actions/ValidateTokenAction";
import type { GetUserPermissionsTask } from "@containers/Auth/Tasks/GetUserPermissionsTask";
import type { PermissionEntry, SessionDTO } from "../DTOs/AuthBridgeDTO";

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

Notice what the adapter does:

1. It imports **type-only** references to the producer's Actions and Tasks (`import type { ... }`). These are erased at compile time — no runtime coupling to the producer's implementation.
2. It calls the producer's **Actions**, not its Tasks directly (with one exception: `GetUserPermissionsTask` is called directly because it's a read-only permission lookup that the Auth domain exposes as a Task). In general, Bridges should call Actions.
3. It maps the producer's internal return type (`AuthSessionDTO`) to the Bridge's external type (`SessionDTO`). This mapping is the anti-corruption layer.

## Why Bridge containers, not Contracts/ folders

You might wonder: why not put the `AuthBridgePort` interface inside a `Contracts/` folder in the `Auth` container itself? That would avoid a separate container. The answer is about **architectural boundaries**:

| Approach | Boundary strength | Ownership | Swap story |
| --- | --- | --- | --- |
| `Contracts/` folder inside producer | Soft — the producer owns its own contract, consumers import from it | Producer | Changing the contract means touching the producer |
| **Bridge container** | Hard — the Bridge is a separate module with its own DTOs and adapter | Bridge (neutral) | Swap the adapter, nothing else changes |

A Bridge container creates a **harder architectural boundary** because:

1. **Clear ownership.** The Bridge owns the contract, not the producer. The producer can refactor its internals freely; only the Adapter needs updating.
2. **Explicit dependency direction.** The consumer imports from the Bridge, the Bridge imports from the producer. There is no ambiguity about who depends on whom.
3. **Swappable implementation.** The Bridge can have multiple adapters (`InProcessAuthBridgeAdapter`, `HttpAuthBridgeAdapter`) without the producer or consumers knowing.
4. **Package extraction.** A Bridge container is self-contained — it can be extracted into its own npm package or microservice boundary without restructuring.

::: warning When NOT to create a Bridge
- **No speculative Bridges.** Only create a Bridge when a consumer actually exists. Don't pre-build Bridges "just in case."
- **Internal concerns are not Bridges.** If `Role` is used only inside the `Auth` container, it's not a Bridge — it's an internal concern.
- **Seeding commands are an exception.** A seeder that touches another container's tables (e.g. `User` seeding roles via `RolesBridge`) is acceptable because it's seed data, not production logic.
:::

## The DI wiring

The Bridge adapter is registered in `registerServices.ts` under a **string token**. Consumers resolve it by that token, never by the adapter class:

```ts
// Ship/Container/registerServices.ts
import { InProcessAuthBridgeAdapter } from "@containers/AuthBridge/Adapters/InProcessAuthBridgeAdapter";

export function createContainer(db: AppDB): Container {
	const container = new Container();

	// ... Auth Actions and Tasks bound above ...

	// Bind the adapter with its dependencies (producer's Actions + Tasks)
	container.bind(
		InProcessAuthBridgeAdapter,
		ValidateTokenAction,
		LogoutAction,
		GetUserPermissionsTask,
	);

	// Register the adapter instance under a string token
	container.set("AuthBridgePort", container.make(InProcessAuthBridgeAdapter));

	return container;
}
```

The key line is:

```ts
container.set("AuthBridgePort", container.make(InProcessAuthBridgeAdapter));
```

This resolves the adapter (which recursively resolves `ValidateTokenAction`, `LogoutAction`, and `GetUserPermissionsTask`), then registers the resulting instance under the string token `"AuthBridgePort"`. Consumers never import `InProcessAuthBridgeAdapter` — they import the `AuthBridgePort` **interface type** and resolve by token.

## How Ship middleware uses the Bridge

Ship's `authContext` plugin resolves `AuthBridgePort` from the container on every request:

```ts
// src/Ship/Http/authContext.ts
import type { AuthBridgePort } from "@containers/AuthBridge/Adapters/InProcessAuthBridgeAdapter";
import type { SessionDTO } from "@containers/AuthBridge/DTOs/AuthBridgeDTO";
import type { Container } from "@ship/Container/Container";
import { Elysia } from "elysia";
import { extractToken } from "./authMiddleware";

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

Notice the imports: `authContext.ts` imports **only types** from the Bridge container (`AuthBridgePort` interface, `SessionDTO`). At runtime, it resolves the concrete adapter from the container by the string token `"AuthBridgePort"`. Ship never knows whether the adapter is in-process or HTTP — it just calls `validateToken()`.

::: tip authContext is wired by routeGroup()
`authContext` is no longer imported directly in route files. The `routeGroup()` helper in `Ship/Http/routeGroup.ts` wires `shipContext`, `authContext`, and `rateLimitMiddleware` together. The default `"api"` preset includes `authContext`; the `"auth"` preset (for login/register routes) skips it. Route files just call `routeGroup("/v1/users")` — they never touch `authContext` directly.
:::

::: tip The type-only import pattern
```ts
import type { AuthBridgePort } from "@containers/AuthBridge/Adapters/InProcessAuthBridgeAdapter";
```
The `import type` ensures this is erased at compile time. Ship has zero runtime dependency on the Auth container. The only runtime link is the string token `"AuthBridgePort"` resolved from the DI container.
:::

The `can()` permission middleware works the same way — it reads `currentUser.permissions` from the `SessionDTO` that `authContext` already resolved:

```ts
// src/Ship/Http/canMiddleware.ts
export function can(resource: string, action: string) {
	return (ctx: AuthedContext) => {
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

## A second example: RolesBridge

The `RolesBridge` container follows the same pattern, exposing role lookups for the User container's seeder:

```ts
// src/Containers/RolesBridge/Adapters/InProcessRolesBridgeAdapter.ts
import type { ListRolesAction } from "@containers/Auth/Actions/ListRolesAction";
import type { RoleSummary } from "@containers/Auth/Actions/ListRolesAction";

export interface RolesBridgePort {
	getAll(): Promise<RoleSummary[]>;
	getByName(name: string): Promise<RoleSummary[]>;
}

export class InProcessRolesBridgeAdapter implements RolesBridgePort {
	constructor(private readonly listRolesAction: ListRolesAction) {}

	async getAll(): Promise<RoleSummary[]> {
		return this.listRolesAction.execute();
	}

	async getByName(name: string): Promise<RoleSummary[]> {
		return this.listRolesAction.executeByName(name);
	}
}
```

Wired in `registerServices.ts`:

```ts
container.bind(InProcessRolesBridgeAdapter, ListRolesAction);
container.set("RolesBridgePort", container.make(InProcessRolesBridgeAdapter));
```

## The full Product ↔ Order example

For a more complex cross-domain scenario, say `Order` needs to check `Product` stock before placing an order. Three containers:

```txt
Containers/
  Product/                              # producer
    Actions/CheckStockAction.ts
    Tasks/StockTask.ts                  # SELECT from stock table
  ProductOrderBridge/                   # bridge
    DTOs/ProductOrderBridgeDTO.ts
    Adapters/InProcessProductOrderBridgeAdapter.ts
  Order/                                # consumer
    Actions/PlaceOrderAction.ts
    Tasks/CreateOrderTask.ts
```

**Bridge DTO** — only what Order needs:

```ts
// ProductOrderBridge/DTOs/ProductOrderBridgeDTO.ts
export interface StockCheckResult {
	productId: string;
	available: boolean;
	quantity: number;
}
```

**Bridge adapter** — calls Product's Action, maps to Bridge DTO:

```ts
// ProductOrderBridge/Adapters/InProcessProductOrderBridgeAdapter.ts
import type { CheckStockAction } from "@containers/Product/Actions/CheckStockAction";
import type { StockCheckResult } from "../DTOs/ProductOrderBridgeDTO";

export interface ProductOrderBridgePort {
	checkStock(productId: string): Promise<StockCheckResult>;
}

export class InProcessProductOrderBridgeAdapter implements ProductOrderBridgePort {
	constructor(private readonly checkStockAction: CheckStockAction) {}

	async checkStock(productId: string): Promise<StockCheckResult> {
		const result = await this.checkStockAction.execute(productId);
		return {
			productId: result.productId,
			available: result.available,
			quantity: result.quantity,
		};
	}
}
```

**Consumer Action** — uses the Bridge, never touches Product internals:

```ts
// Order/Actions/PlaceOrderAction.ts
import type { ProductOrderBridgePort } from "@containers/ProductOrderBridge/Adapters/InProcessProductOrderBridgeAdapter";

export class PlaceOrderAction extends BaseAction {
	constructor(
		db: AppDB,
		private readonly productBridge: ProductOrderBridgePort,
		private readonly createOrderTask: CreateOrderTask,
	) {
		super(db);
	}

	async execute(input: PlaceOrderInput) {
		const stock = await this.productBridge.checkStock(input.productId);
		if (!stock.available) {
			throw new AppError(409, "OUT_OF_STOCK", "Product is out of stock.");
		}
		return await this.createOrderTask.run(input);
	}
}
```

**DI wiring:**

```ts
// registerServices.ts
container.bind(CheckStockAction, "db", StockTask);
container.bind(InProcessProductOrderBridgeAdapter, CheckStockAction);
container.set("ProductOrderBridgePort", container.make(InProcessProductOrderBridgeAdapter));
container.bind(PlaceOrderAction, "db", "ProductOrderBridgePort", CreateOrderTask);
```

**What Order can and cannot import:**

```txt
✅  @containers/ProductOrderBridge/Adapters/InProcessProductOrderBridgeAdapter   (type only)
✅  @containers/ProductOrderBridge/DTOs/ProductOrderBridgeDTO
❌  @containers/Product/Actions/*        ← producer internals
❌  @containers/Product/Tasks/*          ← producer internals
❌  @containers/Product/Models/*         ← producer internals
```

## Future: microservice extraction

The Bridge pattern's payoff comes when you extract a domain into a microservice. Today, `InProcessAuthBridgeAdapter` calls Auth's Actions directly — same process, zero network overhead. Tomorrow, you create `HttpAuthBridgeAdapter`:

```ts
// src/Containers/AuthBridge/Adapters/HttpAuthBridgeAdapter.ts
export class HttpAuthBridgeAdapter implements AuthBridgePort {
	constructor(private readonly baseUrl: string) {}

	async validateToken(token: string): Promise<SessionDTO | null> {
		const res = await fetch(`${this.baseUrl}/internal/validate`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!res.ok) return null;
		return (await res.json()) as SessionDTO;
	}

	async logout(sessionToken: string): Promise<void> {
		await fetch(`${this.baseUrl}/internal/logout`, {
			method: "POST",
			headers: { Authorization: `Bearer ${sessionToken}` },
		});
	}
}
```

Change one line in `registerServices.ts`:

```ts
// Before
container.set("AuthBridgePort", container.make(InProcessAuthBridgeAdapter));

// After
container.set("AuthBridgePort", new HttpAuthBridgeAdapter(process.env.AUTH_SERVICE_URL!));
```

**Zero consumer changes.** Ship's `authContext`, the `can()` middleware, and every route that depends on `currentUser` continue to work identically. The `SessionDTO` contract didn't change — only the transport did.

## Extension points

| You want to… | Do this |
| --- | --- |
| Create a new Bridge | `bun run command make:container ProductOrderBridge` then add `DTOs/` and `Adapters/` |
| Add a method to an existing Bridge | Add it to the Port interface, implement in the adapter, update the DTO if needed |
| Swap in-process for HTTP | Create a new adapter class, change the `container.set()` line in `registerServices.ts` |
| Mock a Bridge in tests | `container.set("AuthBridgePort", mockBridge)` — see [Dependency Injection](./dependency-injection#overriding-services-for-testing) |

## Where to go next

- [Dependency Injection](./dependency-injection) — how the container resolves Bridge adapters and their dependency chains
- [Ship vs Containers](./ship-vs-containers) — why Ship uses Bridge ports instead of direct imports
- [Request Pipeline](./request-pipeline) — how `authContext` uses the Bridge in the request lifecycle
