import type { UserRepository } from "@containers/User/Models/UserRepository";
import type { RawUserEntity } from "@containers/User/Models/user.schema";
import type { CreateUserDTO } from "@containers/User/Requests/user.request";
import type { HashPasswordTask } from "@containers/User/Tasks/HashPasswordTask";
import { BaseAction } from "@ship/Actions/BaseAction";
import type { AppDB } from "@ship/database/connection";

export class CreateUserAction extends BaseAction {
	constructor(
		db: AppDB,
		private readonly userRepo: UserRepository,
		private readonly hashPassword: HashPasswordTask,
	) {
		super(db);
	}

	async execute(payload: CreateUserDTO): Promise<RawUserEntity> {
		const hashedPassword = await this.hashPassword.run(payload.password);

		return await this.db.transaction(async (tx) => {
			const txRepo = this.userRepo.withTransaction(tx);
			await txRepo.assertEmailAvailable(payload.email);
			return await txRepo.create({
				name: payload.name,
				email: payload.email,
				phone: payload.phone ?? null,
				profilePic: payload.profilePic ?? null,
				password: hashedPassword,
				roleId: payload.roleId ?? null,
			});
		});
	}
}
