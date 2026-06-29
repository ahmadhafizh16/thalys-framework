import { ConflictError } from "@ship/Exceptions/AppError";
import { BaseRepository } from "@ship/Repository/BaseRepository";
import type { AppClient } from "@ship/database/connection";
import { eq } from "drizzle-orm";
import { usersTable } from "./user.schema";

export class UserRepository extends BaseRepository<typeof usersTable> {
	constructor(db: AppClient) {
		super(db, usersTable);
	}

	async assertEmailAvailable(email: string): Promise<void> {
		const existing = await this.findOne(eq(usersTable.email, email));
		if (existing) {
			throw new ConflictError(`The email '${email}' is already allocated.`);
		}
	}
}
