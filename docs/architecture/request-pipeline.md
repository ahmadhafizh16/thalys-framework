# Request Pipeline

Every HTTP request in Thalys passes through the same sequence of middleware, plugins, and handlers before producing a response. Understanding this pipeline is essential for debugging latency, adding middleware, and reasoning about authentication and rate limiting.

## The request lifecycle

```txt
HTTP Request
  │
  ▼
requestContext           → requestId (UUID), requestStartedAt (timestamp)
  │
  ▼
profilerPlugin (dev)     → resets query counter, records start time + heap
  │
  ▼
routeGroup()             → .use(shipContext) → db/log/container
  │                      → .use(authContext) → resolves AuthBridgePort,
  │                           validates token → currentUser = SessionDTO | undefined
  │                           (skipped when preset = "auth")
  │                      → .onBeforeHandle(rateLimitMiddleware) → checks RateLimitStore,
  │                           sets X-RateLimit-* headers, throws AppError(429) if exceeded
  ▼
can() (per-route)        → checks currentUser.permissions against required { resource, action }
  │                      → throws ForbiddenError if missing
  ▼
Elysia body validation   → validates body/query/params against TypeBox schemas
  │                      → throws VALIDATION error if invalid (422)
  ▼
controller function      → resolves Action from container
  │                      → calls Action.execute(validatedInput)
  ▼
Action                   → opens db.transaction
  │                      → calls Tasks (one DB op each)
  │                      → returns raw entity
  ▼
Transformer              → maps Raw<Entity> → Safe<Output>
  │
  ▼
wrapResponse()           → envelopes as { data, meta }
  │
  ▼
profilerPlugin (dev)     → injects _profile into meta
  │
  ▼
requestLogger            → logs Pino entry (method, path, status, duration, userId)
  │
  ▼
requestContext (after)   → sets X-Request-Id and X-Response-Time headers
  │
  ▼
HTTP Response            → { success, data, meta } or { success: false, error, message }
```

## requestContext — request ID and timing

The first plugin in the pipeline is `requestContext`. It runs as a `global` derive hook, injecting a `requestId` and `requestStartedAt` into every request's context:

```ts
// src/Ship/Http/requestContext.ts
export const requestContext = new Elysia({ name: "request-context" })
	.derive({ as: "global" }, ({ request }) => ({
		requestId: request.headers.get("x-request-id") ?? randomUUID(),
		requestStartedAt: Date.now(),
	}))
	.onAfterResponse({ as: "global" }, (ctx) => {
		ctx.set.headers["X-Request-Id"] = ctx.requestId;
		ctx.set.headers["X-Response-Time"] = `${Date.now() - ctx.requestStartedAt}ms`;
	});
```

- If the client sends an `X-Request-Id` header, it's reused. Otherwise, a random UUID is generated.
- After the response is sent, `X-Request-Id` and `X-Response-Time` headers are added to the response.

::: tip Correlation across logs
The `requestId` is available in every downstream plugin and route handler via `ctx.requestId`. The `requestLogger` includes it in every log entry, so you can trace a single request across all log lines.
:::

## authContext — current user resolution

`authContext` is a `scoped` derive plugin that resolves the current user on every request. It uses the [AuthBridgePort](./bridge-pattern) to validate the token:

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

Token extraction supports two locations:

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

::: warning authContext is scoped, not global
`authContext` uses `{ as: "scoped" }` instead of `{ as: "global" }`. This means it only runs for route groups that `.use(authContext)` explicitly. This is intentional — public endpoints (like health checks) don't need token validation overhead. In practice, `routeGroup()` handles this for you: the default `"api"` preset includes `authContext`, while the `"auth"` preset (for login/register routes) skips it. If you build a route group manually, you must `.use(authContext)` after `.use(shipContext)`.
:::

If the token is invalid or expired, `validateToken` returns `null` and `currentUser` is `undefined`. The request continues — it's up to the route's `can()` middleware to reject unauthenticated requests.

## rateLimitMiddleware — throttling

Rate limiting is applied per route group via `onBeforeHandle`. The middleware resolves a `RateLimitStore` from the container (Redis in production, in-memory in dev) and checks the request against a preset:

```ts
// src/Ship/Http/rateLimitMiddleware.ts
export function rateLimitMiddleware(store: RateLimitStore, config: RateLimitConfig) {
	const keyFn =
		config.keyGenerator ??
		(({ request }) =>
			request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "anonymous");

	return async (ctx) => {
		const key = keyFn(ctx);
		const result = await store.check(key, config.limit, config.windowMs);

		ctx.set.headers["X-RateLimit-Limit"] = String(result.limit);
		ctx.set.headers["X-RateLimit-Remaining"] = String(result.remaining);
		ctx.set.headers["X-RateLimit-Reset"] = String(result.resetsAt);

		if (!result.allowed) {
			ctx.set.headers["Retry-After"] = String(
				Math.max(0, result.resetsAt - Math.ceil(Date.now() / 1000)),
			);
			throw new AppError(429, "RATE_LIMIT_EXCEEDED", "Too many requests. Please try again later.");
		}
	};
}
```

Thalys ships with three presets:

```ts
// src/Ship/Http/rateLimitPresets.ts
export const RATE_LIMIT_PRESETS = {
	auth: { limit: 5, windowMs: 60_000 },      // login/register endpoints
	api: { limit: 60, windowMs: 60_000 },       // standard API endpoints
	public: { limit: 120, windowMs: 60_000 },   // public endpoints
} as const;
```

Applied via `routeGroup()` — the default `"api"` preset wires `shipContext`, `authContext`, and rate limiting together:

```ts
import { routeGroup } from "@ship/Http/routeGroup";

// "api" preset (default): shipContext + authContext + rateLimitMiddleware(api)
export const userRoutesV1 = routeGroup("/v1/users");

// "auth" preset: shipContext + rateLimitMiddleware(auth), skips authContext
export const authRoutesV1 = routeGroup("/v1/auth", "auth");
```

Under the hood, `routeGroup()` calls `.use(shipContext)`, `.use(authContext)` (for the `"api"` preset), and `.onBeforeHandle(rateLimitMiddleware(...))` — so you never repeat that boilerplate in every route file.

::: tip The rate limit key
By default, the key is the client's IP address (`x-forwarded-for` or `x-real-ip` header, falling back to `"anonymous"`). You can override this with a custom `keyGenerator` — for example, to rate-limit per user ID instead of per IP.
:::

## can() — permission checking

The `can(resource, action)` middleware checks whether the current user has a specific permission. It's applied per-route via `beforeHandle`:

```ts
.get(
	"/",
	async ({ container, query }) => listUsers(query, container as Container),
	{ beforeHandle: [can("user", "read")] },  // ← requires user:read permission
)
```

The permission check supports wildcards:

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

If `currentUser` is `undefined` (no token), `can()` throws `ForbiddenError("Authentication required.")`. If the user lacks the permission, it throws `ForbiddenError()`.

## TypeBox schema validation

Elysia validates request bodies, query params, and path params against TypeBox schemas bound to each route. This happens **before** the route handler runs.

```ts
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

// In the route file — Elysia validates before the controller function runs:
.post(
	"/",
	async ({ container, body, set }) => {
		set.status = 201;
		// body is typed as CreateUserDTO — Elysia guarantees it matches the schema
		return createUser(body, container as Container);
	},
	{ body: CreateUserRequest },
);
```

If validation fails, Elysia throws a `VALIDATION` error. The global handler formats it:

```json
{
  "success": false,
  "error": "SCHEMA_VALIDATION_FAILED",
  "message": "The request schema validation failed.",
  "details": [
    { "path": "/email", "expected": "string (email)", "received": "string" }
  ]
}
```

::: tip TypeBox gives you end-to-end type safety
The `Static<typeof Schema>` derivation means your DTO type is always in sync with the validation schema. If you add a field to the schema, the DTO type updates automatically, and the Action's parameter type checks at compile time.
:::

## QueryCriteria: filter, sort, include, page

For list endpoints, `BaseRequest.parseQuery()` transforms raw query string params into a structured `QueryCriteria` object. Each endpoint declares an **allowlist** of filterable and sortable fields.

### The query string format

```txt
GET /api/v1/users?filter[roleId]=abc-123&filter[email]=test@example.com&sort=-createdAt,name&page[cursor]=xyz&limit=20
```

Parsed into:

```ts
{
	filter: { roleId: "abc-123", email: "test@example.com" },
	sort: [
		{ field: "createdAt", direction: "desc" },
		{ field: "name", direction: "asc" },
	],
	page: { cursor: "xyz", limit: 20 },
}
```

### Per-endpoint allowlists

Each Request class declares which fields are allowed:

```ts
// src/Containers/User/Requests/list-users.request.ts
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

::: warning Unknown fields are rejected
If a client sends `?filter[password]=x`, the parser throws `RequestValidationError` because `password` is not in the `filterable` allowlist. This prevents SQL injection via arbitrary column names and forces teams to explicitly declare which fields clients can query.
:::

### How the parsers work

```ts
// Filter: ?filter[field]=value → { field: value }
function parseFilter(raw, allowed) {
	const filter = {};
	for (const [key, value] of Object.entries(raw)) {
		const match = key.match(/^filter\[(.+)]$/);
		if (!match?.[1] || !value) continue;
		const field = match[1];
		if (!allowed.includes(field)) {
			throw new RequestValidationError(`Filtering by '${field}' is not allowed.`);
		}
		filter[field] = value;
	}
	return filter;
}

// Sort: ?sort=-createdAt,name → [{ field: "createdAt", direction: "desc" }, { field: "name", direction: "asc" }]
function parseSort(raw, allowed, defaultSort) {
	const sortParam = raw.sort;
	if (!sortParam) return defaultSort ? [defaultSort] : [];

	return sortParam.split(",").map((part) => {
		const isDesc = part.startsWith("-");
		const field = isDesc ? part.slice(1) : part;
		if (!allowed.includes(field)) {
			throw new RequestValidationError(`Sorting by '${field}' is not allowed.`);
		}
		return { field, direction: isDesc ? "desc" : "asc" };
	});
}

// Page: ?page[cursor]=abc&limit=20 → { cursor: "abc", limit: 20 }
function parsePage(raw, defaultLimit, maxLimit) {
	const cursor = raw["page[cursor]"];
	const limitParam = raw.limit ?? raw["page[limit]"];
	const limit = limitParam ? Math.min(Number(limitParam), maxLimit) : defaultLimit;
	return { cursor, limit };
}
```

## Pagination: cursor-based and offset-based

`BaseRepository.paginate()` implements **cursor-based pagination** — the most efficient pattern for large datasets because it avoids `OFFSET` scans.

```ts
// src/Ship/Repository/BaseRepository.ts
async paginate(criteria: QueryCriteria): Promise<PaginatedResult<T["$inferSelect"]> {
	const limit = Math.min(criteria.page?.limit ?? 20, 100);

	// Count total matching rows (for meta)
	const countResult = await this.db
		.select({ count: sql<string>`count(*)` })
		.from(this.table)
		.where(this.buildWhereClause(criteria.filter));
	const total = Number(countResult[0]?.count ?? 0);

	// Build the query with filter + sort
	const query = this.db.select().from(this.table);
	const where = this.buildWhereClause(criteria.filter);
	if (where) query.where(where);

	if (criteria.sort?.length) {
		for (const s of criteria.sort) {
			const col = this.col(s.field);
			query.orderBy(s.direction === "desc" ? desc(col) : asc(col));
		}
	}

	// Cursor: only fetch rows AFTER the cursor
	if (criteria.page?.cursor) {
		query.where(gt(this.pk(), criteria.page.cursor));
	}

	// Fetch limit + 1 to determine hasMore
	query.limit(limit + 1);
	const rows = await query;

	const hasMore = rows.length > limit;
	const data = rows.slice(0, limit);
	const lastRow = data[data.length - 1];
	const cursor = hasMore && lastRow ? String(lastRow[this.pkName()]) : null;

	return { data, meta: { total, cursor, hasMore } };
}
```

::: tip Why cursor-based, not offset-based?
`OFFSET 100000 LIMIT 20` forces PostgreSQL to scan and discard 100,000 rows. Cursor-based pagination uses `WHERE id > cursor LIMIT 20`, which is an index lookup — O(1) regardless of how deep you paginate. The trade-off is that cursors don't support random page access (you can't jump to "page 50"), but for API pagination, sequential access is the right model.
:::

The controller function wraps the paginated result:

```ts
// src/Containers/User/UI/API/Controllers/listUsers.ts
export async function listUsers(query: Record<string, string | undefined>, container: Container) {
	const criteria = ListUsersRequest.parse(query);
	const userRepo = container.make(UserRepository);
	const result = await userRepo.paginate(criteria);
	const transformer = new UserTransformer();
	return wrapPaginated(
		result.data.map((u) => transformer.transform(u)),
		result.meta,
	);
}

// In the route:
.get("/", async ({ container, query }) => listUsers(query, container as Container));
```

Response:

```json
{
  "data": [
    { "id": "019234...", "fullName": "Alice", "emailAddress": "alice@example.com" }
  ],
  "meta": {
    "total": 1500,
    "cursor": "019234...",
    "hasMore": true
  }
}
```

The client requests the next page with `?page[cursor]=019234...`.

## The response envelope

Every Thalys endpoint returns a consistent envelope. There are two shapes:

### Success response

```ts
// Single resource
{ "data": { ... }, "meta": {} }

// Paginated collection
{ "data": [...], "meta": { "total": 1500, "cursor": "...", "hasMore": true } }
```

Produced by the `wrapResponse()` and `wrapPaginated()` helpers:

```ts
// src/Ship/Http/MainController.ts
export function wrapResponse<TData>(data: TData): ResponseEnvelope<TData> {
	return { data, meta: {} };
}

export function wrapPaginated<TData>(
	data: TData[],
	meta: PaginatedMeta,
): ResponseEnvelope<TData[], PaginatedMeta> {
	return { data, meta };
}
```

### Error response

```json
{
  "success": false,
  "error": "NOT_FOUND",
  "message": "User could not be located."
}
```

Produced by the global error handler (see below).

::: tip Why an envelope?
A consistent envelope means clients can parse every response the same way: check `success`, read `data` or `error`. The `meta` field carries pagination info, profiling data, and other non-data metadata without polluting the `data` array.
:::

## The global error handler

The global `onError` handler in `Ship/setup.ts` catches every error thrown during the request lifecycle and formats it into the error envelope. It must use `{ as: "global" }` — without it, Elysia keeps the hook local-scoped and route errors silently never fire.

```ts
// src/Ship/setup.ts
.onError({ as: "global" }, ({ code, error, set, request }) => {
	const locale = parseLocale(request.headers.get("accept-language"));

	// 1. TypeBox validation errors (422)
	if (code === "VALIDATION") {
		set.status = 422;
		return {
			success: false,
			error: "SCHEMA_VALIDATION_FAILED",
			message: lz("errors.SCHEMA_VALIDATION_FAILED", locale),
			details: error.all,
		};
	}

	// 2. AppError and subclasses (NotFoundError, ConflictError, etc.)
	if (error instanceof AppError) {
		set.status = error.statusCode;
		const message = error.messageKey
			? lz(error.messageKey, locale, error.messageParams)
			: error.message;
		return {
			success: false,
			error: error.code,
			message,
		};
	}

	// 3. Better Auth APIError — map to our envelope
	if (error instanceof APIError) {
		const statusMap = {
			UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
			CONFLICT: 409, BAD_REQUEST: 400, TOO_MANY_REQUESTS: 429,
			INTERNAL_SERVER_ERROR: 500,
		};
		set.status = statusMap[error.status] ?? 500;
		if (set.status >= 500) {
			container.make<ErrorReporter>("ErrorReporter").capture(error, { path: request.url });
		}
		return {
			success: false,
			error: "AUTH_ERROR",
			message: error.body?.message ?? error.message,
		};
	}

	// 4. Unhandled exceptions (500)
	set.status = 500;
	logger.error({ err: error }, "Unhandled internal exception");
	container.make<ErrorReporter>("ErrorReporter").capture(error, { path: request.url });
	return {
		success: false,
		error: "UNHANDLED_INTERNAL_ERROR",
		message: lz("errors.UNHANDLED_INTERNAL_ERROR", locale),
	};
});
```

::: warning The `as: "global"` trap
Elysia lifecycle hooks are **local-scoped by default**. If you register `onError` without `{ as: "global" }`, the handler only catches errors thrown in the same Elysia instance — not errors thrown in container route groups that `.use()` the context. This is the most common cause of "my error handler isn't firing" bugs.
:::

### Localization in error messages

The handler resolves the locale from the `Accept-Language` header and uses `lz()` (the localization helper) to translate error messages. `AppError` subclasses can declare a `messageKey` and `messageParams` for localized messages:

```ts
export class NotFoundError extends AppError {
	constructor(resource: string) {
		super(404, "NOT_FOUND", `${resource} could not be located.`, "errors.NOT_FOUND", { resource });
	}
}
```

If `messageKey` is set, the handler calls `lz(messageKey, locale, messageParams)` instead of using the raw `message`. This lets clients receive localized error messages without any code changes in Actions or Tasks.

## The profiler (dev only)

In non-production environments, the `profilerPlugin` tracks request duration, DB query count, and memory delta. It injects a `_profile` object into the response's `meta` field.

```ts
// src/Ship/Http/profiler.ts
export const profilerPlugin = isProduction
	? new Elysia({ name: "profiler:off" })  // no-op in production
	: new Elysia({ name: "profiler" })
		.derive({ as: "global" }, () => {
			resetQueryCount();
			return {
				_profileStart: performance.now(),
				_profileStartHeap: process.memoryUsage().heapUsed,
			};
		})
		.onAfterHandle({ as: "global" }, (ctx) => {
			const duration = performance.now() - ctx._profileStart;
			const memoryBytes = process.memoryUsage().heapUsed - ctx._profileStartHeap;

			const profile = {
				duration: Math.round(duration * 100) / 100,
				queries: queryCount,
				memoryBytes,
			};

			if (body?.meta && typeof body.meta === "object") {
				body.meta._profile = profile;
			}
		});
```

The query count is incremented by a Proxy wrapper around the Drizzle `db` client:

```ts
// src/Ship/database/queryCounter.ts
export function wrapDbWithQueryCounter(db: AppDB): AppDB {
	if (process.env.NODE_ENV === "production") return db;

	return new Proxy(db, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (typeof value === "function" && ["select", "insert", "update", "delete", "execute"].includes(prop)) {
				return (...args) => {
					incrementQueryCount();
					return value.apply(target, args);
				};
			}
			return value;
		},
	});
}
```

A dev response looks like:

```json
{
  "data": { "id": "019234...", "fullName": "Alice" },
  "meta": {
    "_profile": {
      "duration": 12.45,
      "queries": 3,
      "memoryBytes": 524288
    }
  }
}
```

::: tip Profiler is dev-only
In production, `profilerPlugin` returns a no-op Elysia instance and `wrapDbWithQueryCounter` returns the raw `db` — zero overhead. The `_profile` field never appears in production responses.
:::

## requestLogger — structured logging

The `requestLoggerPlugin` logs one Pino entry per request with method, path, status, duration, and user ID. It hooks both `onAfterHandle` (for successful responses) and `onError` (for error responses), because `onAfterHandle` doesn't fire when an error is thrown.

```ts
// src/Ship/Http/requestLogger.ts
function logRequest(logger, ctx) {
	const duration = ctx._logStartedAt ? Date.now() - ctx._logStartedAt : 0;
	const status = typeof ctx.set.status === "string" ? parseInt(ctx.set.status, 10) : ctx.set.status ?? 500;

	const entry = {
		requestId: ctx.requestId,
		method: ctx.request.method,
		path: url.pathname,
		status,
		duration,
		userId: ctx.currentUser?.userId,
		ip: ctx.request.headers.get("x-forwarded-for") ?? "127.0.0.1",
	};

	if (status >= 500) logger.error(entry, "request");
	else if (status >= 400) logger.warn(entry, "request");
	else logger.info(entry, "request");
}
```

Health check requests (`/api/health`) are skipped to avoid log noise from orchestrator probes.

Logs are shipped to MongoDB via `pino-mongodb` and to `pino-pretty` in non-production. Logging is **hit-and-run** — logging failures must not roll back application database work.

## Putting it all together

Here's the full lifecycle for `POST /api/v1/users` with a valid token:

```txt
1. requestContext         → requestId = "abc-123", requestStartedAt = 1719700000000
2. profilerPlugin (dev)   → resetQueryCount(), _profileStart = 12.345ms
3. routeGroup("api")      → shipContext → db/log/container injected
                             authContext → token = "Bearer xyz"
                              → AuthBridgePort.validateToken("xyz")
                              → currentUser = { userId: "u1", permissions: [...] }
                             rateLimitMiddleware → key = "127.0.0.1", check(60, 60000) → allowed: true, remaining: 59
4. Elysia body validation → body matches CreateUserRequest → body: CreateUserDTO
5. controller function    → createUser(body, container)
                             → action = container.make(CreateUserAction)
                             → action.execute(body)
6. CreateUserAction       → hashPassword.run("password123") → "$2b$12$..."
                             → db.transaction(tx => {
                                 txRepo.assertEmailAvailable("alice@test.com")
                                 txRepo.create({ ... }) → rawUser
                               })
7. UserTransformer        → rawUser → { id, fullName, emailAddress, registeredOn }
8. wrapResponse()         → { data: { ... }, meta: {} }
9. set.status = 201
10. profilerPlugin (dev)  → meta._profile = { duration: 45.2, queries: 2, memoryBytes: 1MB }
11. requestLogger         → info: { requestId, method: "POST", path: "/api/v1/users", status: 201, duration: 45, userId: "u1" }
12. requestContext (after)→ X-Request-Id: "abc-123", X-Response-Time: "46ms"
13. HTTP 201              → { data: { ... }, meta: { _profile: { ... } } }
```

## Extension points

| You want to… | Do this |
| --- | --- |
| Add a new middleware | Create an Elysia plugin in `Ship/Http/`, wire it into `routeGroup()` or `shipContext` |
| Add a new rate limit preset | Add to `RATE_LIMIT_PRESETS` in `Ship/Http/rateLimitPresets.ts` |
| Change the rate limit key | Pass a `keyGenerator` function to `rateLimitMiddleware()` |
| Add a new permission | Use `can("resource", "action")` in a route's `beforeHandle` |
| Change the error response shape | Modify the `onError` handler in `Ship/setup.ts` |
| Add a new query filter field | Add it to the Request class's `filterable` allowlist |
| Change pagination defaults | Override `defaultLimit` / `maxLimit` in the Request class's allowlist |
| Disable the profiler | Set `NODE_ENV=production` |
| Swap the rate limit store | Change the `container.set("rateLimitStore", ...)` binding in `registerServices.ts` |

## Where to go next

- [Porto Layers](./porto-layers) — what happens inside the Action → Task → Transformer flow
- [Dependency Injection](./dependency-injection) — how the container resolves Actions and their dependencies
- [Bridge Pattern](./bridge-pattern) — how `authContext` resolves `AuthBridgePort` per-request
