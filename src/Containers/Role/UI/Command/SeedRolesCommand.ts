import type { Command } from "commander";
import type { ConsoleCommand } from "@ship/Console/ConsoleCommand";
import type { ConsoleContext } from "@ship/Console/ConsoleContext";
import { SeedRolesAction } from "@containers/Role/Actions/SeedRolesAction";

export class SeedRolesCommand implements ConsoleCommand {
	readonly signature = "db:seed:roles";
	readonly description = "Seed default e-commerce RBAC roles and permissions";

	register(program: Command, context: ConsoleContext): void {
		program
			.command(this.signature)
			.description(this.description)
			.action(async () => {
				const result = await SeedRolesAction.execute(context.db);
				context.log.info(result, "Roles seeded");
			});
	}
}
