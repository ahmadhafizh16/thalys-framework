import type { UserRepository } from "@containers/User/Models/UserRepository";
import { usersTable } from "@containers/User/Models/user.schema";
import { BaseAction } from "@ship/Actions/BaseAction";
import { NotFoundError } from "@ship/Exceptions/AppError";
import type { AppDB } from "@ship/database/connection";
import { eq } from "drizzle-orm";

export class DeleteUserAction extends BaseAction {
	constructor(
		db: AppDB,
		private readonly userRepo: UserRepository,
	) {
		super(db);
	}

	async execute(id: string): Promise<void> {
		await this.db.transaction(async (tx) => {
			const txRepo = this.userRepo.withTransaction(tx);
			const existing = await txRepo.findById(id);
			if (!existing) throw new NotFoundError("User");
			await txRepo.delete(eq(usersTable.id, id));
		});
	}
}
