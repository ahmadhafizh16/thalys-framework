import type { AppClient } from "@ship/database/connection";
import { usersTable } from "../Models/user.schema";

export interface SeedUserInsertInput {
	name: string;
	email: string;
	phone: string | null;
	profilePic: string | null;
	passwordHash: string;
	roleId: number;
}

export class InsertSeedUsersTask {
	static async run(dbClient: AppClient, users: readonly SeedUserInsertInput[]): Promise<number> {
		if (users.length === 0) {
			return 0;
		}

		const inserted = await dbClient.insert(usersTable).values([...users]).returning({
			id: usersTable.id,
		});

		return inserted.length;
	}
}
