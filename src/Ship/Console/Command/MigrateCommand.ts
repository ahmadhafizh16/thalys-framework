import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ConsoleCommand } from "@ship/Console/ConsoleCommand";
import type { ConsoleContext } from "@ship/Console/ConsoleContext";

// ── db:generate ──────────────────────────────────────────

type GenerateInput = { name?: string };

export class MigrateGenerateCommand extends ConsoleCommand<GenerateInput> {
	readonly signature = "db:generate {name? : Migration name}";
	readonly description = "Generate a new Drizzle migration from schema changes";

	handle(input: GenerateInput, _context: ConsoleContext): void {
		const args = ["run", "drizzle-kit", "generate"];
		if (input.name) args.push("--name", input.name);

		const result = Bun.spawnSync(args, {
			cwd: process.cwd(),
			stdio: ["inherit", "inherit", "inherit"],
		});

		if (result.exitCode !== 0) {
			throw new Error("Migration generation failed.");
		}
	}
}

// ── db:migrate ───────────────────────────────────────────

export class MigrateRunCommand extends ConsoleCommand {
	readonly signature = "db:migrate";
	readonly description = "Apply pending database migrations";

	handle(_input: Record<string, unknown>, _context: ConsoleContext): void {
		const result = Bun.spawnSync(["run", "drizzle-kit", "migrate"], {
			cwd: process.cwd(),
			stdio: ["inherit", "inherit", "inherit"],
		});

		if (result.exitCode !== 0) {
			throw new Error("Migration failed.");
		}
	}
}

// ── db:status ────────────────────────────────────────────

interface JournalEntry {
	idx: number;
	version: string;
	when: number;
	tag: string;
}

export class MigrateStatusCommand extends ConsoleCommand {
	readonly signature = "db:status";
	readonly description = "Show applied and pending migrations";

	handle(_input: Record<string, unknown>, context: ConsoleContext): void {
		const migrationsDir = join(process.cwd(), "drizzle");
		const journalPath = join(migrationsDir, "meta", "_journal.json");

		if (!existsSync(journalPath)) {
			context.log.info("No migrations found. Run 'db:generate' to create one.");
			return;
		}

		const journal: { entries: JournalEntry[] } = JSON.parse(readFileSync(journalPath, "utf-8"));
		const entries = journal.entries ?? [];

		// Scan for SQL files in drizzle/
		const sqlFiles = existsSync(migrationsDir)
			? readdirSync(migrationsDir)
					.filter((f) => f.endsWith(".sql"))
					.sort()
			: [];

		const appliedTags = new Set(entries.map((e) => e.tag));
		const pending = sqlFiles.filter((f) => {
			// SQL filenames like "0000_tag_name.sql" → match against journal tag
			const tag = f.replace(/\.sql$/, "");
			return !appliedTags.has(tag);
		});

		context.log.info(
			{
				total: sqlFiles.length,
				applied: entries.length,
				pending: pending.length,
				migrations: sqlFiles.map((f) => ({
					file: f,
					status: appliedTags.has(f.replace(/\.sql$/, "")) ? "applied" : "pending",
				})),
			},
			"Migration status",
		);
	}
}
