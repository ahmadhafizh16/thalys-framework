import type { AppClient } from "@ship/database/connection";
import { type RawUserEntity, usersTable } from "../Models/user.schema";
import type { CreateUserDTO } from "../Requests/user.request";

export type InsertUserInput = Omit<CreateUserDTO, "password"> & {
	passwordHash: string;
};

export class InsertUserTask {
	static async run(dbClient: AppClient, data: InsertUserInput): Promise<RawUserEntity> {
		const insertedRecords = await dbClient
			.insert(usersTable)
			.values({
				name: data.name,
				email: data.email,
				phone: data.phone ?? null,
				profilePic: data.profilePic ?? null,
				passwordHash: data.passwordHash,
				roleId: data.roleId,
			})
			.returning();

		const created = insertedRecords[0];
		if (!created) {
			throw new Error("Insert returned no row.");
		}
		return created;
	}
}
