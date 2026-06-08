import { faker } from "@faker-js/faker";
import { ListRolesAction } from "@containers/Role/Actions/ListRolesAction";
import type { AppDB } from "@ship/database/connection";
import { HashPasswordTask } from "../Tasks/HashPasswordTask";
import { InsertSeedUsersTask, type SeedUserInsertInput } from "../Tasks/InsertSeedUsersTask";

export interface SeedUsersInput {
	count: number;
	password: string;
	roleName?: string;
}

export interface SeedUsersResult {
	inserted: number;
	roleMode: "fixed" | "random";
}

export class SeedUsersAction {
	static async execute(db: AppDB, input: SeedUsersInput): Promise<SeedUsersResult> {
		if (!Number.isInteger(input.count) || input.count < 1) {
			throw new Error("Seed user count must be a positive integer.");
		}

		const passwordHash = await HashPasswordTask.run(input.password);

		return await db.transaction(async (tx) => {
			const roles = await ListRolesAction.execute(tx, input.roleName);
			if (roles.length === 0) {
				const suffix = input.roleName ? ` named '${input.roleName}'` : "";
				throw new Error(
					`No roles${suffix} found. Run: bun run command db:seed:roles`,
				);
			}

			const users: SeedUserInsertInput[] = Array.from({ length: input.count }, () => {
				const role = input.roleName ? roles[0] : faker.helpers.arrayElement(roles);
				if (!role) {
					throw new Error("Unable to choose a role for seeded user.");
				}

				return {
					name: faker.person.fullName(),
					email: faker.internet.email({
						firstName: faker.string.uuid(),
						provider: "example.test",
					}).toLowerCase(),
					phone: faker.phone.number(),
					profilePic: faker.image.avatar(),
					passwordHash,
					roleId: role.id,
				};
			});

			const inserted = await InsertSeedUsersTask.run(tx, users);
			return {
				inserted,
				roleMode: input.roleName ? "fixed" : "random",
			};
		});
	}
}
