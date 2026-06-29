import { incrementQueryCount } from "@ship/Http/profiler";
import type { AppDB } from "./connection";

/**
 * Wrap a Drizzle DB client to count queries via the profiler's global counter.
 * Only wraps the query-building methods (select/insert/update/delete/execute).
 * Returns the original db object unchanged in production.
 */
export function wrapDbWithQueryCounter(db: AppDB): AppDB {
	if (process.env.NODE_ENV === "production") return db;

	return new Proxy(db, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);

			// Only wrap the query-building methods that hit the database
			if (
				typeof value === "function" &&
				(prop === "select" ||
					prop === "insert" ||
					prop === "update" ||
					prop === "delete" ||
					prop === "execute")
			) {
				return (...args: unknown[]) => {
					incrementQueryCount();
					return value.apply(target, args);
				};
			}

			return value;
		},
	}) as AppDB;
}
