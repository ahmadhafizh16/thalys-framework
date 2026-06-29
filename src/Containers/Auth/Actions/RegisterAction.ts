import type { AuthSessionDTO, RegisterInput } from "@containers/Auth/DTOs/AuthDTO";
import type { RegisterTask } from "@containers/Auth/Tasks/RegisterTask";
import { BaseAction } from "@ship/Actions/BaseAction";
import type { AppDB } from "@ship/database/connection";

export class RegisterAction extends BaseAction {
	constructor(
		db: AppDB,
		private readonly registerTask: RegisterTask,
	) {
		super(db);
	}

	async execute(input: RegisterInput): Promise<{ session: AuthSessionDTO; token: string }> {
		return await this.registerTask.run(input);
	}
}
