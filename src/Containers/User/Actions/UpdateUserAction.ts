import type { UserRepository } from "@containers/User/Models/UserRepository";
import { usersTable } from "@containers/User/Models/user.schema";
import type { RawUserEntity } from "@containers/User/Models/user.schema";
import { BaseAction } from "@ship/Actions/BaseAction";
import { NotFoundError } from "@ship/Exceptions/AppError";
import type { AppDB } from "@ship/database/connection";
import { eq } from "drizzle-orm";

export interface UpdateUserInput {
	id: string;
	name?: string;
	phone?: string | null;
	profilePic?: string | null;
	roleId?: string | null;
}

export class UpdateUserAction extends BaseAction {
	constructor(
		db: AppDB,
		private readonly userRepo: UserRepository,
	) {
		super(db);
	}

	async execute(input: UpdateUserInput): Promise<RawUserEntity> {
		return await this.db.transaction(async (tx) => {
			const txRepo = this.userRepo.withTransaction(tx);
			const existing = await txRepo.findById(input.id);
			if (!existing) throw new NotFoundError("User");

			const updates: Partial<typeof usersTable.$inferInsert> = {};
			if (input.name !== undefined) updates.name = input.name;
			if (input.phone !== undefined) updates.phone = input.phone;
			if (input.profilePic !== undefined) updates.profilePic = input.profilePic;
			if (input.roleId !== undefined) updates.roleId = input.roleId;

			const updated = await txRepo.update(eq(usersTable.id, input.id), updates);
			if (!updated) throw new NotFoundError("User");
			return updated;
		});
	}
}
