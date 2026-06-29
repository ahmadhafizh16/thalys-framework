import type { AuthSessionDTO } from "../DTOs/AuthDTO";
import type { auth } from "../betterAuth.config";

export class ValidateTokenTask {
	constructor(private readonly authInstance: typeof auth) {}

	async run(token: string): Promise<AuthSessionDTO | null> {
		try {
			const result = await this.authInstance.api.getSession({
				headers: new Headers({ Authorization: `Bearer ${token}` }),
			});

			if (!result) return null;

			return {
				userId: result.user.id,
				email: result.user.email,
				name: result.user.name,
				sessionId: result.session.id,
				expiresAt: result.session.expiresAt.getTime(),
			};
		} catch {
			return null;
		}
	}
}
