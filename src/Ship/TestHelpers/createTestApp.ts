import type { CacheStore } from "@ship/Cache/CacheStore";
import type { Container } from "@ship/Container/Container";
import { createContainer } from "@ship/Container/registerServices";
import type { QueueDriver } from "@ship/Queue/QueueDriver";
import type { AppDB } from "@ship/database/connection";
import { Elysia } from "elysia";

/** Minimal interface satisfied by Elysia apps — used by RequestTester. */
export interface Handleable {
	handle(request: Request): Promise<Response>;
}

interface TestAppOptions {
	/** Real database instance (from connection.ts or a test DB). */
	db: AppDB;
	/** Override the AuthBridgePort with a mock (avoids real auth flow). */
	mockAuthBridge?: unknown;
	/** Override the cache store (e.g. a fresh InMemoryCacheStore per test). */
	cache?: CacheStore;
	/** Override the queue driver. */
	queue?: QueueDriver;
	/** Elysia route plugins to mount (instances or functions). */
	// biome-ignore lint/suspicious/noExplicitAny: Elysia generics narrow per .use(), making precise typing impossible
	routes?: any[];
}

/**
 * Assemble a minimal Elysia app for testing.
 * Returns the app (for RequestTester) and the container (for service overrides).
 *
 * Usage:
 * ```ts
 * const { app, container } = createTestApp({
 *   db,
 *   mockAuthBridge: createMockAuthBridge(),
 *   routes: [userRoutesV1],
 * });
 * const tester = new RequestTester(app);
 * ```
 */
export function createTestApp(options: TestAppOptions): { app: Handleable; container: Container } {
	const container = createContainer(options.db);

	if (options.mockAuthBridge) {
		container.set("AuthBridgePort", options.mockAuthBridge);
	}
	if (options.cache) {
		container.set("cache", options.cache);
	}
	if (options.queue) {
		container.set("queue", options.queue);
	}

	// Build the Elysia app. Routes are mounted via the options.
	// Elysia's use() returns a narrower type each call, so we accumulate
	// by chaining. The `as Handleable` at the return strips the generic
	// complexity — RequestTester only needs handle().
	const base = new Elysia({ prefix: "/api" })
		.decorate("db", options.db)
		.decorate("container", container);

	if (!options.routes?.length) {
		return { app: base as unknown as Handleable, container };
	}

	// Chain all route plugins. Elysia's generic type changes on each .use() call,
	// so we use a loose intermediate — the final cast to Handleable is safe.
	// biome-ignore lint/suspicious/noExplicitAny: Elysia generics narrow per .use()
	let chained: any = base;
	for (const routePlugin of options.routes) {
		chained = chained.use(routePlugin);
	}

	return { app: chained as Handleable, container };
}
