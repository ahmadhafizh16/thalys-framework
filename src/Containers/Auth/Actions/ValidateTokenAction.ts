import type { AuthSessionDTO } from "@containers/Auth/DTOs/AuthDTO";
import type { ValidateTokenTask } from "@containers/Auth/Tasks/ValidateTokenTask";
import { BaseAction } from "@ship/Actions/BaseAction";
import type { AppDB } from "@ship/database/connection";

export class ValidateTokenAction extends BaseAction {
	constructor(
		db: AppDB,
		private readonly validateTokenTask: ValidateTokenTask,
	) {
		super(db);
	}

	async execute(token: string): Promise<AuthSessionDTO | null> {
		return await this.validateTokenTask.run(token);
	}
}
