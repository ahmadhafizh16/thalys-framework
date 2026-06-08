import type { Command } from "commander";
import { sql } from "drizzle-orm";
import type { ConsoleCommand } from "../ConsoleCommand";
import type { ConsoleContext } from "../ConsoleContext";

const ALLOWED_TABLES = new Set([
	"notifications",
	"role_permissions",
	"roles",
	"users",
]);

export class TruncateTableCommand implements ConsoleCommand {
	readonly signature = "db:truncate";
	readonly description = "Truncate one or more allowed application tables";

	register(program: Command, context: ConsoleContext): void {
		program
			.command(this.signature)
			.description(this.description)
			.argument("<tables...>", "table names to truncate")
			.option("--force", "confirm destructive truncate operation")
			.action(async (tables: string[], options: { force?: boolean }) => {
				if (!options.force) {
					throw new Error("Refusing to truncate without --force.");
				}

				const uniqueTables = [...new Set(tables)];
				for (const table of uniqueTables) {
					if (!ALLOWED_TABLES.has(table)) {
						throw new Error(
							`Table '${table}' is not allowed. Allowed tables: ${[...ALLOWED_TABLES].join(", ")}`,
						);
					}
				}

				const identifiers = uniqueTables.map((table) => sql.identifier(table));
				await context.db.execute(sql`TRUNCATE TABLE ${sql.join(identifiers, sql`, `)} RESTART IDENTITY CASCADE`);

				context.log.warn({ tables: uniqueTables }, "Tables truncated");
			});
	}
}
