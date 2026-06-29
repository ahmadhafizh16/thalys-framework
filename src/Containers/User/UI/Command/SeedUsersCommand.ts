import type { RolesBridgePort } from "@containers/RolesBridge/Adapters/InProcessRolesBridgeAdapter";
import { CreateUserAction } from "@containers/User/Actions/CreateUserAction";
import type { CreateUserDTO } from "@containers/User/Requests/user.request";
import { faker } from "@faker-js/faker";
import { ConsoleCommand } from "@ship/Console/ConsoleCommand";
import type { ConsoleContext } from "@ship/Console/ConsoleContext";
import type { Container } from "@ship/Container/Container";

type SeedUsersInput = {
	count: string;
	password: string;
	role?: string;
};

export class SeedUsersCommand extends ConsoleCommand<SeedUsersInput> {
	readonly signature = `db:seed:users
		{--c|count=50 : Number of users to seed}
		{--p|password=password123 : Plain password to hash for seeded users}
		{--r|role= : Specific role name to assign to every seeded user}`;
	readonly description = "Seed fake e-commerce users with hashed passwords";

	async handle(input: SeedUsersInput, context: ConsoleContext): Promise<void> {
		const count = Number.parseInt(input.count, 10);
		if (!Number.isInteger(count) || count < 1) {
			throw new Error("Seed user count must be a positive integer.");
		}

		const rolesBridge = (context.container as Container).make<RolesBridgePort>("RolesBridgePort");
		const roles = input.role ? await rolesBridge.getByName(input.role) : await rolesBridge.getAll();

		if (roles.length === 0) {
			const suffix = input.role ? ` named '${input.role}'` : "";
			throw new Error(`No roles${suffix} found. Run: bun run command db:seed:roles`);
		}

		const action = (context.container as Container).make(CreateUserAction);

		for (let index = 0; index < count; index += 1) {
			const role = input.role ? roles[0] : faker.helpers.arrayElement(roles);
			if (!role) {
				throw new Error("Unable to choose a role for seeded user.");
			}

			const payload: CreateUserDTO = {
				name: faker.person.fullName(),
				email: faker.internet
					.email({
						firstName: faker.string.uuid(),
						provider: "example.test",
					})
					.toLowerCase(),
				phone: faker.phone.number(),
				profilePic: faker.image.avatar(),
				password: input.password,
				roleId: role.id,
			};

			await action.execute(payload);
		}

		context.log.info(
			{
				inserted: count,
				roleMode: input.role ? "fixed" : "random",
			},
			"Users seeded",
		);
	}
}
