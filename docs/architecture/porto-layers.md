# Porto Layers

Every container in Thalys follows the same internal layering, inspired by the [Porto](https://github.com/Porto-SAP/Porto) architecture. The layers are strictly ordered — each layer may only call the layer below it, never above or sideways. This makes every endpoint readable by following exactly one file per layer.

## The layers at a glance

```txt
Containers/Product/
├── Models/
│   ├── product.schema.ts       # Drizzle pgTable — the single source of truth for types
│   └── ProductRepository.ts    # extends BaseRepository<typeof productsTable>
├── Requests/
│   ├── create-product.request.ts   # TypeBox body schema
│   ├── update-product.request.ts   # TypeBox body schema (partial)
│   └── list-products.request.ts    # BaseRequest subclass with filter/sort allowlists
├── Actions/
│   ├── CreateProductAction.ts      # db.transaction, orchestrates Tasks, maps via Transformer
│   ├── UpdateProductAction.ts
│   └── DeleteProductAction.ts
├── Tasks/
│   ├── HashSkuTask.ts              # one system operation
│   └── InvalidateCacheTask.ts      # one system operation
├── Transformers/
│   └── ProductTransformer.ts       # RawProductEntity → SafeProductOutput
└── UI/
    ├── API/
    │   ├── v1/routes.ts            # HTTP Elysia routes — thin wiring, delegates to Controllers
    │   └── Controllers/            # one controller function per file
    │       ├── createProduct.ts    # async function: input + Container → Action → Transformer → wrapResponse
    │       ├── getProduct.ts
    │       └── listProducts.ts
    └── Command/
        └── SeedProductsCommand.ts  # class-based console command
```

The flow is always one-directional:

```txt
Route → Request validation → Controller function → Action.execute() → Task.run() → Transformer.transform() → wrapResponse() → HTTP response
```

## UI/API — HTTP routes

Route files live at `UI/API/v1/routes.ts`. They are **thin wiring** — they import controller functions, wire them to Elysia routes via `routeGroup()`, and delegate all logic. The `routeGroup()` helper (from `Ship/Http/routeGroup.ts`) replaces the repeated `.use(shipContext).use(authContext).onBeforeHandle(rateLimit)` boilerplate. By default it applies the `"api"` preset, which includes `shipContext`, `authContext`, and rate limiting. Use the `"auth"` preset for login/register routes that should skip `authContext`.

Each route delegates to a **controller function** in `UI/API/Controllers/` — one function per file. The controller resolves an Action from the container, calls it, transforms the result, and returns `wrapResponse(...)`.

```ts
// src/Containers/User/UI/API/Controllers/createUser.ts
import { CreateUserAction } from "@containers/User/Actions/CreateUserAction";
import type { CreateUserDTO } from "@containers/User/Requests/user.request";
import { UserTransformer } from "@containers/User/Transformers/UserTransformer";
import type { Container } from "@ship/Container/Container";
import { wrapResponse } from "@ship/Http/MainController";

const transformer = new UserTransformer();

export async function createUser(body: CreateUserDTO, container: Container) {
	const action = container.make(CreateUserAction);
	const created = await action.execute(body);
	return wrapResponse(transformer.transform(created));
}
```

```ts
// src/Containers/User/UI/API/Controllers/getUser.ts
import type { Container } from "@ship/Container/Container";
import { NotFoundError } from "@ship/Exceptions/AppError";
import { BaseRequest } from "@ship/Http/BaseRequest";
import { wrapResponse } from "@ship/Http/MainController";
import { UserRepository } from "@containers/User/Models/UserRepository";
import { UserTransformer } from "@containers/User/Transformers/UserTransformer";

const transformer = new UserTransformer();

export async function getUser(params: { id: string }, container: Container) {
	const id = BaseRequest.validateId(params.id);
	const userRepo = container.make(UserRepository);
	const user = await userRepo.findById(id);
	if (!user) throw new NotFoundError("User");
	return wrapResponse(transformer.transform(user));
}
```

The route file just wires controllers to HTTP verbs:

```ts
// src/Containers/User/UI/API/v1/routes.ts
import { createUser } from "@containers/User/UI/API/Controllers/createUser";
import { getUser } from "@containers/User/UI/API/Controllers/getUser";
import type { Container } from "@ship/Container/Container";
import { can } from "@ship/Http/canMiddleware";
import { routeGroup } from "@ship/Http/routeGroup";
import { CreateUserRequest } from "@containers/User/Requests/user.request";

export const userRoutesV1 = routeGroup("/v1/users")
	.post("/", async ({ container, body, set }) => {
		set.status = 201;
		return createUser(body, container as Container);
	}, { body: CreateUserRequest })
	.get("/:id", async ({ container, params }) => getUser(params, container as Container),
		{ beforeHandle: [can("user", "read")] });
```

For login/register routes that should skip `authContext`, use the `"auth"` preset:

```ts
// src/Containers/Auth/UI/API/v1/routes.ts
export const authRoutesV1 = routeGroup("/v1/auth", "auth")
	.post("/login", async ({ container, body }) => login(body, container as Container),
		{ body: LoginRequest })
	.post("/register", async ({ container, body }) => register(body, container as Container),
		{ body: RegisterRequest });
```

::: tip Routes are wiring, not logic
A route handler should do three things: set HTTP-specific concerns (status code), delegate to a controller function, and return. Any branching, database access, or business logic belongs in a controller function or an Action. If a route handler grows past a few lines, extract a controller function.
:::

### When a controller orchestrates multiple Actions

For single-Action endpoints, the controller function calls one Action directly (as above). When a route needs to orchestrate **multiple Actions** — for example, a dashboard endpoint that aggregates data from three domains — the controller function calls multiple Actions and assembles the result:

```ts
// src/Containers/User/UI/API/Controllers/getDashboard.ts
import type { Container } from "@ship/Container/Container";
import { GetUserAction } from "@containers/User/Actions/GetUserAction";
import { GetStatsAction } from "@containers/User/Actions/GetStatsAction";
import { GetNotificationsAction } from "@containers/User/Actions/GetNotificationsAction";
import { wrapResponse } from "@ship/Http/MainController";

export async function getDashboard(userId: string, container: Container) {
	const [user, stats, notifications] = await Promise.all([
		container.make(GetUserAction).execute(userId),
		container.make(GetStatsAction).execute(userId),
		container.make(GetNotificationsAction).execute(userId),
	]);
	return wrapResponse({ user, stats, notifications });
}
```

The route delegates to the controller:

```ts
.get("/dashboard", async ({ container, currentUser }) =>
	getDashboard(currentUser.userId, container as Container),
	{ beforeHandle: [can("dashboard", "read")] });
```

::: warning Controllers don't open transactions
A controller function orchestrates multiple Actions, each of which manages its own transaction. If the operations need to be atomic (all succeed or all roll back), they belong in a **single Action**, not a controller. Controllers are for read-side aggregation, not write-side atomicity.
:::

## UI/Command — console commands

Console commands are class-based and live in the owning container. They implement `ConsoleCommand` from `Ship/Console/ConsoleCommand.ts`, receive dependencies via `ConsoleContext` (`db`, `log`), and call Actions — never Tasks directly.

```ts
// src/Containers/Role/UI/Command/SeedRolesCommand.ts
export class SeedRolesCommand implements ConsoleCommand {
	signature = "db:seed:roles";
	description = "Seed default roles and permissions";

	async handle(ctx: ConsoleContext): Promise<void> {
		const action = new SeedRolesAction(ctx.db);
		await action.execute();
		ctx.log.info("Roles seeded successfully.");
	}
}
```

Commands are registered explicitly in `Ship/Console/commands.ts`:

```ts
import { SeedRolesCommand } from "@containers/Role/UI/Command/SeedRolesCommand";
import { SeedUsersCommand } from "@containers/User/UI/Command/SeedUsersCommand";

export const commands = [SeedRolesCommand, SeedUsersCommand];
```

Run them via the console kernel:

```bash
bun run command db:seed:roles
bun run command db:seed:users --count 50 --password password123
bun run command db:truncate users --force
```

## Requests — input validation

The Requests layer has two responsibilities:

1. **Body validation** — TypeBox schemas bound to route handlers via Elysia's `{ body: Schema }` config. Elysia validates automatically and returns a `VALIDATION` error if the body doesn't match.
2. **Query criteria parsing** — `BaseRequest` subclasses that parse `?filter[field]`, `?sort`, `?page[cursor]`, `?limit` into a typed `QueryCriteria` object, with per-endpoint allowlists.

### Body validation (TypeBox)

```ts
// src/Containers/User/Requests/user.request.ts
import { type Static, t } from "elysia";

export const CreateUserRequest = t.Object({
	name: t.String({ minLength: 2 }),
	email: t.String({ format: "email" }),
	phone: t.Optional(t.String()),
	profilePic: t.Optional(t.String()),
	password: t.String({ minLength: 8 }),
	roleId: t.String({ format: "uuid" }),
});

export type CreateUserDTO = Static<typeof CreateUserRequest>;
```

The schema is bound to the route, and Elysia validates before the controller function runs:

```ts
.post(
	"/",
	async ({ container, body, set }) => {
		set.status = 201;
		// body is typed as CreateUserDTO — fully type-safe
		return createUser(body, container as Container);
	},
	{ body: CreateUserRequest },  // ← Elysia validates this
);
```

If validation fails, Elysia throws a `VALIDATION` error that the global handler catches and formats as:

```json
{
  "success": false,
  "error": "SCHEMA_VALIDATION_FAILED",
  "message": "The request schema validation failed.",
  "details": [...]
}
```

### Query criteria (BaseRequest)

For list endpoints, a `BaseRequest` subclass declares which fields are filterable and sortable, then parses raw query params into `QueryCriteria`:

```ts
// src/Containers/User/Requests/list-users.request.ts
import { type Allowlist, BaseRequest } from "@ship/Http/BaseRequest";

export class ListUsersRequest extends BaseRequest {
	protected static readonly allowlist: Allowlist = {
		filterable: ["roleId", "email"],
		sortable: ["name", "createdAt"],
		defaultSort: { field: "createdAt", direction: "desc" },
		defaultLimit: 20,
		maxLimit: 100,
	};

	static parse(raw: Record<string, string | undefined>) {
		return this.parseQuery(raw, this.allowlist);
	}
}
```

Usage in a controller function:

```ts
// src/Containers/User/UI/API/Controllers/listUsers.ts
export async function listUsers(query: Record<string, string | undefined>, container: Container) {
	const criteria = ListUsersRequest.parse(query);
	// criteria = { filter: { roleId: "..." }, sort: [{ field: "createdAt", direction: "desc" }], page: { limit: 20 } }
	const userRepo = container.make(UserRepository);
	const result = await userRepo.paginate(criteria);
	const transformer = new UserTransformer();
	return wrapPaginated(
		result.data.map((u) => transformer.transform(u)),
		result.meta,
	);
}
```

And the route delegates:

```ts
.get("/", async ({ container, query }) => listUsers(query, container as Container));
```

::: tip Allowlists prevent SQL injection via field names
`BaseRequest.parseQuery()` rejects any `filter[field]` or `sort=field` that isn't in the allowlist. This prevents clients from injecting arbitrary column names into queries. Unknown fields throw `RequestValidationError` (400).
:::

### ID validation

`BaseRequest.validateId()` validates path parameters before they reach the Action — inside a controller function:

```ts
// src/Containers/User/UI/API/Controllers/getUser.ts
export async function getUser(params: { id: string }, container: Container) {
	const id = BaseRequest.validateId(params.id);  // throws 400 if invalid format
	const userRepo = container.make(UserRepository);
	const user = await userRepo.findById(id);
	if (!user) throw new NotFoundError("User");
	return wrapResponse(transformer.transform(user));
}
```

::: warning validateId checks syntax, not existence
`validateId()` validates the **format** of the ID. The Action/Repository resolves it to a row and throws `NotFoundError` if it doesn't exist. This separation keeps the Request layer focused on syntax, and the Action on semantics.
:::

## Actions — transactional orchestration

Actions are the **transactional boundary**. They open `db.transaction(...)`, orchestrate Tasks inside it, and map the result through a Transformer.

```ts
// src/Containers/User/Actions/CreateUserAction.ts
export class CreateUserAction extends BaseAction {
	constructor(
		db: AppDB,
		private readonly userRepo: UserRepository,
		private readonly hashPassword: HashPasswordTask,
	) {
		super(db);
	}

	async execute(payload: CreateUserDTO): Promise<RawUserEntity> {
		const hashedPassword = await this.hashPassword.run(payload.password);

		return await this.db.transaction(async (tx) => {
			const txRepo = this.userRepo.withTransaction(tx);
			await txRepo.assertEmailAvailable(payload.email);
			return await txRepo.create({
				name: payload.name,
				email: payload.email,
				phone: payload.phone ?? null,
				profilePic: payload.profilePic ?? null,
				password: hashedPassword,
				roleId: payload.roleId ?? null,
			});
		});
	}
}
```

Key rules for Actions:

- **Static `execute(...)`** — the entry point. Receives validated input (DTOs), returns domain output.
- **Opens `db.transaction(...)`** — all database writes happen inside a transaction. If any Task throws, the transaction rolls back.
- **Calls Tasks** — delegates individual operations to Tasks. Does not write to the database directly.
- **Receives `db` via injection** — never imports the singleton `db`. The container injects it.
- **Returns raw entities** — the Action returns the raw database row. The controller function maps it through a Transformer.

::: tip Actions CAN call other Actions
A sub-Action is valid. For example, a `RegisterUserAction` might call `CreateUserAction` internally, then call `AssignRoleAction`. Each Action manages its own transaction. What is forbidden is a **Task** calling another Task — that creates a hidden coupling that defeats the one-operation-per-file contract.
:::

## Tasks — single DB/system operation

Tasks do exactly **one** database or system operation. They are classes with a `run(...)` method. Tasks accept `AppClient` (= `AppDB | AppTx`) so they work with both the pool and a transaction.

```ts
// A Task that hashes a password — one system operation, no DB
export class HashPasswordTask {
	async run(password: string): Promise<string> {
		return await Bun.password.hash(password, { algorithm: "bcrypt", cost: 12 });
	}
}

// A Task that validates a token — one external API call
export class ValidateTokenTask {
	constructor(private readonly authInstance: typeof auth) {}

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
}
```

::: warning Tasks never call other Tasks
This is the most important rule in the Porto layering. A Task that calls another Task creates a hidden dependency chain that makes the codebase impossible to reason about. If two operations must happen together, put them in an Action. If the same operation is reused, extract it into its own Task and let each Action call it independently.

```ts
// ❌ Bad — Task calling a Task
export class CreateUserTask {
	async run(data: CreateUserDTO) {
		const hashed = await this.hashPasswordTask.run(data.password);  // NEVER
		return await this.userRepo.create({ ...data, password: hashed });
	}
}

// ✅ Good — Action orchestrates Tasks
export class CreateUserAction extends BaseAction {
	async execute(payload: CreateUserDTO) {
		const hashed = await this.hashPassword.run(payload.password);  // Action calls Task
		return await this.db.transaction(async (tx) => {
			return await this.userRepo.withTransaction(tx).create({ ...payload, password: hashed });
		});
	}
}
```
:::

## Transformers — client-facing response shape

Transformers explicitly define the response shape that clients see. They prevent internal database columns from leaking into API responses.

```ts
// src/Containers/User/Transformers/UserTransformer.ts
import type { RawUserEntity } from "@containers/User/Models/user.schema";
import { BaseTransformer } from "@ship/Transformers/BaseTransformer";

export interface SafeUserOutput {
	id: string;
	fullName: string;
	emailAddress: string;
	phone: string | null;
	profilePic: string | null;
	roleId: string | null;
	registeredOn: string;
}

export class UserTransformer extends BaseTransformer<RawUserEntity, SafeUserOutput> {
	transform(user: RawUserEntity): SafeUserOutput {
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
}
```

Notice what the Transformer does:

1. **Renames fields** — `name` → `fullName`, `email` → `emailAddress`, `createdAt` → `registeredOn`. The client never sees the internal column names.
2. **Excludes fields** — `password`, `emailVerified`, `updatedAt` are not in `SafeUserOutput`. They simply don't appear in the response.
3. **Transforms types** — `createdAt` (a `Date`) → `registeredOn` (an ISO string). The client receives a serializable string, not a Date object.

::: tip Transformers never touch the database
A Transformer is a pure function: `RawEntity → SafeOutput`. It does not make database calls, does not resolve relations, does not fetch additional data. If the response needs related data, the Action fetches it and passes it to the Transformer.
:::

The controller function applies the Transformer before wrapping the response:

```ts
// Inside a controller function
const created = await action.execute(body);
return wrapResponse(transformer.transform(created));
```

## Models — Drizzle schemas + Repositories

### Schema files

Postgres schemas live in `Models/*.schema.ts` and use Drizzle's `pgTable`. Drizzle-kit only scans `*.schema.ts` files — non-Postgres models must not use that suffix.

```ts
// src/Containers/User/Models/user.schema.ts
import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

export const usersTable = pgTable("users", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => uuidv7()),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified").notNull().default(false),
	image: text("image"),
	phone: text("phone"),
	profilePic: text("profile_pic"),
	password: text("password"),
	roleId: uuid("role_id"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type RawUserEntity = typeof usersTable.$inferSelect;
export type InsertUserEntity = typeof usersTable.$inferInsert;
```

::: tip The schema is the single source of truth
`RawUserEntity` and `InsertUserEntity` are derived from the schema via Drizzle's `$inferSelect` and `$inferInsert`. Actions, Tasks, and Transformers all import these types — there is no separate DTO definition for database rows. Change the schema, and every layer's types update automatically.
:::

### Repository classes

Repositories extend `BaseRepository<T>` and add domain-specific query methods:

```ts
// src/Containers/User/Models/UserRepository.ts
export class UserRepository extends BaseRepository<typeof usersTable> {
	constructor(db: AppClient) {
		super(db, usersTable);
	}

	async assertEmailAvailable(email: string): Promise<void> {
		const existing = await this.findOne(eq(usersTable.email, email));
		if (existing) {
			throw new ConflictError(`The email '${email}' is already allocated.`);
		}
	}
}
```

`BaseRepository` provides CRUD, cursor pagination, filter/sort, and `withTransaction(tx)`:

```ts
// Inherited from BaseRepository
await repo.findById(id);
await repo.findOne(where);
await repo.findMany(where, limit);
await repo.create(data);
await repo.update(where, data);
await repo.delete(where);
await repo.paginate(criteria);

// Scope to a transaction
const txRepo = repo.withTransaction(tx);
```

## Error handling: throw, don't catch

Thalys's error handling philosophy is simple: **throw, don't catch**. The global `onError` handler in `Ship/setup.ts` catches every error and formats it into the standard response envelope.

```ts
// In a route handler — throw, don't return an error
const user = await userRepo.findById(id);
if (!user) throw new NotFoundError("User");

// In an Action — throw domain errors
await txRepo.assertEmailAvailable(payload.email);  // throws ConflictError if taken

// In a Task — throw system errors
throw new AppError(500, "EXTERNAL_API_FAILED", "The external API is unavailable.");
```

The global handler catches three error categories:

| Error type | Source | HTTP status | Response shape |
| --- | --- | --- | ---|
| `AppError` (and subclasses) | Your code — `NotFoundError`, `ConflictError`, etc. | The `statusCode` on the error | `{ success: false, error: code, message }` |
| `APIError` (Better Auth) | Better Auth library | Mapped from auth status codes | `{ success: false, error: "AUTH_ERROR", message }` |
| `VALIDATION` | Elysia TypeBox validation | 422 | `{ success: false, error: "SCHEMA_VALIDATION_FAILED", details }` |
| Anything else | Unhandled exceptions | 500 | `{ success: false, error: "UNHANDLED_INTERNAL_ERROR", message }` |

::: tip 5xx errors are reported
When the global handler catches a 500-level error (including Better Auth's `INTERNAL_SERVER_ERROR`), it calls `container.make<ErrorReporter>("ErrorReporter").capture(error, { path })`. The default `ConsoleErrorReporter` logs to stderr; swap it for Sentry or Loki by changing the binding in `registerServices.ts`.
:::

## The complete flow

Putting it all together, here's what happens when a client creates a user:

```txt
POST /api/v1/users
  │
  ▼
routeGroup("/v1/users")    → shipContext (db/log/container) + authContext (currentUser)
  │                         + rateLimitMiddleware (api preset)
  ▼
Elysia body validation    → validates body against CreateUserRequest (TypeBox)
  │                       → if invalid: 422 SCHEMA_VALIDATION_FAILED
  ▼
controller function       → createUser(body, container)
  │                         container.make(CreateUserAction)
  │                         new UserTransformer()
  ▼
CreateUserAction.execute(body)
  │                       → hashPassword.run(password)    ← Task
  │                       → db.transaction(async (tx) => {
  │                           txRepo = userRepo.withTransaction(tx)
  │                           txRepo.assertEmailAvailable(email)  ← throws ConflictError if taken
  │                           return txRepo.create({...})         ← BaseRepository.create()
  │                       })
  ▼
UserTransformer.transform(rawUser)   → SafeUserOutput (no password, renamed fields)
  │
  ▼
wrapResponse(safeUser)    → { data: safeUser, meta: {} }
  │
  ▼
profilerPlugin (dev)      → injects _profile into meta
  │
  ▼
requestLogger             → logs { method, path, status, duration, userId }
  │
  ▼
HTTP 201 response         → { data: { id, fullName, emailAddress, ... }, meta: { _profile: {...} } }
```

## Extension points

| You want to… | Do this |
| --- | --- |
| Add a new endpoint | Add a controller function in `UI/API/Controllers/`, wire it in `routes.ts` via `routeGroup()` |
| Add a new body schema | Create a TypeBox `t.Object()` in `Requests/`, bind it with `{ body: Schema }` |
| Add a new query allowlist | Subclass `BaseRequest`, set `filterable` / `sortable` / `defaultSort` |
| Add a new Action | Create a class extending `BaseAction`, bind it in `registerServices.ts` |
| Add a new Task | Create a class with `async run(...)`, bind it in `registerServices.ts` |
| Add a new Transformer | Create a class extending `BaseTransformer<TInput, TOutput>` |
| Add a new Model | Create a `*.schema.ts` file, run `bun run db:generate` |
| Add a new Repository | Create a class extending `BaseRepository<typeof table>` |
| Add a new error type | Extend `AppError` in `Ship/Exceptions/AppError.ts` — the handler catches it |
| Add a controller function | Create an `async function` in `UI/API/Controllers/`, call Actions, return `wrapResponse(...)` |

## Where to go next

- [Request Pipeline](./request-pipeline) — the full request lifecycle from middleware to response
- [Dependency Injection](./dependency-injection) — how Actions and Tasks get their dependencies
- [Bridge Pattern](./bridge-pattern) — how cross-container communication works
