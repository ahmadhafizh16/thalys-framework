import type { AppDB, AppTx } from "@ship/database/connection";

/**
 * Sentinel error — distinguishes intentional rollback from real failures.
 * @internal
 */
export class RollbackSignal extends Error {
	constructor() {
		super("__ROLLBACK__");
		this.name = "RollbackSignal";
	}
}

/**
 * Run a callback inside a database transaction that is always rolled back.
 * Useful for tests: the callback can insert/query data freely, and nothing
 * persists to the database after the test completes.
 *
 * Usage:
 * ```ts
 * await withTestTransaction(db, async (tx) => {
 *   const repo = new UserRepository(tx);
 *   await repo.create({ name: "Test", email: "test@test.com" });
 *   const user = await repo.findByEmail("test@test.com");
 *   expect(user).not.toBeNull();
 * });
 * // DB is clean — the transaction was rolled back
 * ```
 */
export async function withTestTransaction(
	db: AppDB,
	callback: (tx: AppTx) => Promise<void>,
): Promise<void> {
	try {
		await db.transaction(async (tx) => {
			await callback(tx as AppTx);
			// Always roll back — throw the sentinel
			throw new RollbackSignal();
		});
	} catch (error) {
		if (error instanceof RollbackSignal) return; // Expected — test succeeded
		throw error; // Real error — re-throw
	}
}
