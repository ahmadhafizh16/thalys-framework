import type { Command } from "commander";
import type { ConsoleCommand } from "@ship/Console/ConsoleCommand";
import type { ConsoleContext } from "@ship/Console/ConsoleContext";
import { SeedUsersAction } from "@containers/User/Actions/SeedUsersAction";

export class SeedUsersCommand implements ConsoleCommand {
	readonly signature = "db:seed:users";
	readonly description = "Seed fake e-commerce users with hashed passwords";

	register(program: Command, context: ConsoleContext): void {
		program
			.command(this.signature)
			.description(this.description)
			.option("-c, --count <count>", "number of users to seed", "50")
			.option("-p, --password <password>", "plain password to hash for seeded users", "password123")
			.option("-r, --role <role>", "specific role name to assign to every seeded user")
			.action(async (options: { count: string; password: string; role?: string }) => {
				const count = Number.parseInt(options.count, 10);
				const result = await SeedUsersAction.execute(context.db, {
					count,
					password: options.password,
					roleName: options.role,
				});

				context.log.info(result, "Users seeded");
			});
	}
}
