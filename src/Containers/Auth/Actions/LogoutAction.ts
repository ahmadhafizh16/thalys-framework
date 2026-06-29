import type { LogoutTask } from "@containers/Auth/Tasks/LogoutTask";
import { BaseAction } from "@ship/Actions/BaseAction";
import type { AppDB } from "@ship/database/connection";

export class LogoutAction extends BaseAction {
	constructor(
		db: AppDB,
		private readonly logoutTask: LogoutTask,
	) {
		super(db);
	}

	async execute(sessionToken: string): Promise<void> {
		await this.logoutTask.run(sessionToken);
	}
}
