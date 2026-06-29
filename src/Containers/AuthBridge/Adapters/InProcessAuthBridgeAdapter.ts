import type { LogoutAction } from "@containers/Auth/Actions/LogoutAction";
import type { ValidateTokenAction } from "@containers/Auth/Actions/ValidateTokenAction";
import type { GetUserPermissionsTask } from "@containers/Auth/Tasks/GetUserPermissionsTask";
import type { PermissionEntry, SessionDTO } from "../DTOs/AuthBridgeDTO";

export interface AuthBridgePort {
	validateToken(token: string): Promise<SessionDTO | null>;
	logout(sessionToken: string): Promise<void>;
}

export class InProcessAuthBridgeAdapter implements AuthBridgePort {
	constructor(
		private readonly validateTokenAction: ValidateTokenAction,
		private readonly logoutAction: LogoutAction,
		private readonly getUserPermissionsTask: GetUserPermissionsTask,
	) {}

	async validateToken(token: string): Promise<SessionDTO | null> {
		const authSession = await this.validateTokenAction.execute(token);
		if (!authSession) return null;

		let permissions: PermissionEntry[] = [];
		try {
			permissions = await this.getUserPermissionsTask.run(authSession.userId);
		} catch {
			// User may not have a role yet — no permissions
		}

		return {
			userId: authSession.userId,
			email: authSession.email,
			name: authSession.name,
			sessionId: authSession.sessionId,
			expiresAt: authSession.expiresAt,
			permissions,
		};
	}

	async logout(sessionToken: string): Promise<void> {
		await this.logoutAction.execute(sessionToken);
	}
}
