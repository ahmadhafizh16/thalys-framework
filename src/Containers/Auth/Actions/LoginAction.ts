import type { AuthSessionDTO, LoginInput } from "@containers/Auth/DTOs/AuthDTO";
import type { LoginTask } from "@containers/Auth/Tasks/LoginTask";
import { BaseAction } from "@ship/Actions/BaseAction";
import type { AppDB } from "@ship/database/connection";

export class LoginAction extends BaseAction {
	constructor(
		db: AppDB,
		private readonly loginTask: LoginTask,
	) {
		super(db);
	}

	async execute(input: LoginInput): Promise<{ session: AuthSessionDTO; token: string }> {
		return await this.loginTask.run(input);
	}
}
