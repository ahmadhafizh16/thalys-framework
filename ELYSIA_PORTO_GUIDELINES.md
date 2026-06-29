# Engineering Guidelines: ElysiaJS + Porto Architecture

This project uses **ElysiaJS**, **Drizzle ORM**, **Bun**, and a Porto-inspired container structure. The goal is strict separation between shared infrastructure (`Ship`) and isolated business domains (`Containers`).

## 1. Import aliases

Use TypeScript path aliases for Ship and Containers imports:

```ts
import type { AppClient } from "@ship/database/connection";
import { SeedUsersAction } from "@containers/User/Actions/SeedUsersAction";
```

Configured aliases:

- `@ship/*` -> `src/Ship/*`
- `@containers/*` -> `src/Containers/*`

Prefer aliases for cross-layer and cross-container imports. Same-container sibling imports may stay relative when that keeps the local flow readable.

## 2. Top-level structure

```txt
src/
  Ship/
    Console/          # CLI kernel with signature parsing
    Exceptions/       # AppError hierarchy
    database/         # Drizzle/Postgres AppDb connection
    logger.ts         # pino + pino-mongodb logger
    setup.ts          # Elysia shared context and global error handler

  Containers/
    <Domain>/
      UI/
        API/
          v1/routes.ts     # thin route wiring (paths + schemas + guards)
          Controllers/     # one controller function per file
        Command/           # class-based console commands
      Requests/       # TypeBox input schemas
      Actions/        # orchestration + transaction boundary
      Tasks/          # one DB/system operation each
      Transformers/   # client-facing response shaping
      Models/         # Drizzle table schemas
```

`Ship` owns infrastructure. `Containers` own business behavior. A container may expose more than one UI adapter: HTTP APIs under `UI/API` and CLI commands under `UI/Command`.

## 2b. Request and command flow

HTTP flow:

```txt
UI/API/v1/routes.ts → UI/API/Controllers/*.ts → Actions → Tasks → Transformers
```

Console flow:

```txt
UI/Command/*Command.ts → Actions → Tasks
```

Both are UI adapters. Neither API routes nor console commands should perform database writes directly. Route files are thin wiring — they map paths to controller functions and configure body schemas + `can()` guards. Handler logic lives in controller functions.

## 3. Layer rules

### UI/API

- Define Elysia routes using functional method chaining via `routeGroup()` from `Ship/Http/routeGroup.ts`.
- `routeGroup()` wires `shipContext` + `authContext` + rate limiting in one call. Use the `"auth"` preset for sessionless routes (login, register).
- Route files live at `UI/API/v1/routes.ts` and contain only thin wiring: paths, body schemas, and `can()` guards.
- Handler logic lives in `UI/API/Controllers/*.ts` — one controller function per file. Each is a plain `async function` that takes typed input + `Container`, calls Actions, transforms the result, and returns `wrapResponse(...)`.
- Do not put command behavior in API routes.

### UI/Command

- Console commands are class-based and live in the owning container, e.g. `src/Containers/Auth/UI/Command/SeedRolesCommand.ts`.
- Commands implement `ConsoleCommand` from `Ship/Console/ConsoleCommand.ts`.
- Commands receive shared dependencies via `ConsoleContext` (`db`, `log`).
- Commands call Actions, never Tasks directly.

### Actions

- Actions are classes with `async execute(...)`.
- Actions are the transaction boundary: open `db.transaction(...)`, orchestrate Tasks, return domain output.
- Actions receive DB clients via constructor injection (resolved via `container.make(Action)`). Do not import the singleton `db` into Actions.
- Actions may call another container's Action when crossing a domain boundary.

### Tasks

- Tasks are classes with `async run(...)`.
- A Task performs exactly one DB/system operation.
- A Task never calls another Task or an Action.
- Tasks that use Postgres accept `AppClient` from `Ship/database/connection.ts`, so they work with either `db` or transaction `tx`.

### Transformers

- Transformers explicitly define the client-facing response shape. Internal columns never leak to the API response.

### Models

- Postgres schemas live in `Models/*.schema.ts` and use Drizzle `pgTable`.
- Drizzle-kit only scans `*.schema.ts`; non-Postgres models must not use that suffix.
- Primary keys use app-side UUIDv7: `$defaultFn(() => uuidv7())`. Time-sortable, exists before INSERT (usable as FK in same transaction). Junction/internal tables may use integer PKs (never exposed).

## 4. Cross-container boundary (Bridge containers)

A container that needs another container's behavior imports from a **Bridge container**, never from the producer's internals.

```
Containers/
  Auth/                  # producer
  User/                  # producer
  AuthBridge/            # bridge: Ship/authContext → Auth
    DTOs/
      AuthBridgeDTO.ts   # SessionDTO (the data shape consumers need)
    Adapters/
      InProcessAuthBridgeAdapter.ts  # calls Auth's Actions
```

- Bridge containers are the **only** import target for cross-container communication.
- A Bridge holds **DTOs** (flat, serializable) and an **Adapter** that calls the producer container's **Actions**.
- Never import a Task, Model, Transformer, or Request from another container.
- The adapter is registered in `Ship/Container/registerServices.ts` and resolved via the DI container.
- A future `HttpAuthBridgeAdapter` (calling a remote Auth microservice) replaces `InProcessAuthBridgeAdapter` with zero changes to the consumer.

**When to create a Bridge:**

- Only when a consumer exists. No speculative Bridges.
- Only for cross-domain dependencies. Internal concerns (e.g. Role inside Auth) are not a Bridge.
- Seeding commands that touch another container's tables are an exception (seed data, not production logic).

Good:

```ts
import type { AuthBridgePort } from "@containers/AuthBridge/Adapters/InProcessAuthBridgeAdapter";
const authBridge = container.make("AuthBridgePort") as AuthBridgePort;
const session = await authBridge.validateToken(token);
```

Bad:

```ts
import { LoginAction } from "@containers/Auth/Actions/LoginAction";
const action = container.make(LoginAction);  // ← bypasses Bridge, couples to Auth internals
await action.execute(...);
```

### Full example: Product ↔ Order via Bridge

Say Order needs to check stock before placing an order. Three containers:

```
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
		return { productId: result.productId, available: result.available, quantity: result.quantity };
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
	) { super(db); }

	async execute(input: PlaceOrderInput) {
		const stock = await this.productBridge.checkStock(input.productId);
		if (!stock.available) throw new AppError(409, "OUT_OF_STOCK", "Product is out of stock.");
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

```
✅  @containers/ProductOrderBridge/Adapters/InProcessProductOrderBridgeAdapter
✅  @containers/ProductOrderBridge/DTOs/ProductOrderBridgeDTO
❌  @containers/Product/Actions/*        ← producer internals
❌  @containers/Product/Tasks/*          ← producer internals
❌  @containers/Product/Models/*         ← producer internals
```

## 5. Ship infrastructure

### Database

`Ship/database/connection.ts` exports:

- `db` — Drizzle client for PostgreSQL AppDb.
- `AppDB` — type of `db`.
- `AppTx` — transaction client type.
- `AppClient` — `AppDB | AppTx`; use this in Tasks.

### Logger

`Ship/logger.ts` exports the pino logger. Logs go to MongoDB via `pino-mongodb` using `MONGO_URL`, and to `pino-pretty` in non-production.

Logging is hit-and-run. Logging failures must not roll back application DB work.

`Ship/setup.ts` decorates API routes with:

- `db`
- `log`
- `container`

`Ship/Http/routeGroup.ts` provides `routeGroup(prefix, preset?)` which wires `shipContext` + `authContext` + rate limiting in one call. Route files use this instead of manually chaining `.use()` calls.

The global error handler must use `{ as: "global" }`; otherwise Elysia keeps the hook local and route errors are not caught.

## 6. Console

The root `command.ts` boots the Ship console kernel without starting the HTTP server.

```bash
bun run command --help
bun run command db:seed:roles
bun run command db:seed:users --count 50 --password password123
bun run command db:truncate users --force
```

Console files:

```txt
src/Ship/Console/ConsoleCommand.ts
src/Ship/Console/ConsoleContext.ts
src/Ship/Console/ConsoleKernel.ts
src/Ship/Console/commands.ts
```

Register commands explicitly in `Ship/Console/commands.ts`. Prefer explicit registration until the project has enough commands to justify auto-discovery.

## 7. Seeding

Use class commands + Actions + Tasks for seeders:

```txt
Auth/UI/Command/SeedRolesCommand.ts
Auth/Actions/ListRolesAction.ts
Auth/Models/permission.schema.ts
Auth/Models/role.schema.ts
```

Use `@faker-js/faker` for fake data when adding user/product/order seeders. Keep deterministic seeds where test repeatability matters.

## 8. Operational notes

- Runtime is Bun; do not use Node-specific scripts when a Bun equivalent exists.
- Typecheck with `bun run typecheck` after every code change.
- Migrations are generated by `bun run db:generate` and applied by `bun run db:migrate`.
- Local services are reached via SSH tunnel: Postgres on `localhost:30001`, Mongo on `localhost:30003`, Redis on `localhost:30002`.
