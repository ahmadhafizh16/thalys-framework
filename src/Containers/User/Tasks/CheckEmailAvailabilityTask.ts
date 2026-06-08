import { eq } from "drizzle-orm";
import type { AppClient } from "@ship/database/connection";
import { ConflictError } from "@ship/Exceptions/AppError";
import { usersTable } from "../Models/user.schema";

export class CheckEmailAvailabilityTask {
	static async run(dbClient: AppClient, email: string): Promise<void> {
		const records = await dbClient
			.select()
			.from(usersTable)
			.where(eq(usersTable.email, email))
			.limit(1);

		if (records.length > 0) {
			throw new ConflictError(`The email '${email}' is already allocated.`);
		}
	}
}
