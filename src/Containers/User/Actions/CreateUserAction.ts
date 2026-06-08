import type { AppDB } from "@ship/database/connection";
import type { CreateUserDTO } from "../Requests/user.request";
import { CheckEmailAvailabilityTask } from "../Tasks/CheckEmailAvailabilityTask";
import { HashPasswordTask } from "../Tasks/HashPasswordTask";
import { InsertUserTask } from "../Tasks/InsertUserTask";
import { type SafeUserOutput, UserTransformer } from "../Transformers/UserTransformer";

export class CreateUserAction {
	static async execute(db: AppDB, payload: CreateUserDTO): Promise<SafeUserOutput> {
		const passwordHash = await HashPasswordTask.run(payload.password);

		// Atomic transaction: both DB tasks share `tx`; any failure rolls back fully.
		const rawSavedUser = await db.transaction(async (tx) => {
			await CheckEmailAvailabilityTask.run(tx, payload.email);
			return await InsertUserTask.run(tx, {
				name: payload.name,
				email: payload.email,
				phone: payload.phone,
				profilePic: payload.profilePic,
				roleId: payload.roleId,
				passwordHash,
			});
		});

		return UserTransformer.transform(rawSavedUser);
	}
}
