import { ConsoleCommand } from "@ship/Console/ConsoleCommand";
import type { ConsoleContext } from "@ship/Console/ConsoleContext";
import { sql } from "drizzle-orm";

const ALLOWED_TABLES = new Set(["role_permissions", "roles", "users"]);

type TruncateTableInput = {
	tables: string[];
	force?: boolean;
};

export class TruncateTableCommand extends ConsoleCommand<TruncateTableInput> {
	readonly signature = `db:truncate
		{tables* : Table names to truncate}
		{--force : Confirm destructive truncate operation}`;
	readonly description = "Truncate one or more allowed application tables";

	async handle(input: TruncateTableInput, context: ConsoleContext): Promise<void> {
		if (!input.force) {
			throw new Error("Refusing to truncate without --force.");
		}

		const uniqueTables = [...new Set(input.tables)];
		for (const table of uniqueTables) {
			if (!ALLOWED_TABLES.has(table)) {
				throw new Error(
					`Table '${table}' is not allowed. Allowed tables: ${[...ALLOWED_TABLES].join(", ")}`,
				);
			}
		}

		const identifiers = uniqueTables.map((table) => sql.identifier(table));
		await context.db.execute(
			sql`TRUNCATE TABLE ${sql.join(identifiers, sql`, `)} RESTART IDENTITY CASCADE`,
		);

		context.log.warn({ tables: uniqueTables }, "Tables truncated");
	}
}
