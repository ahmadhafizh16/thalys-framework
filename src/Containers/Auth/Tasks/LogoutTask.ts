import type { auth } from "../betterAuth.config";

export class LogoutTask {
	constructor(private readonly authInstance: typeof auth) {}

	async run(sessionToken: string): Promise<void> {
		try {
			await this.authInstance.api.revokeSession({
				body: { token: sessionToken },
				headers: new Headers({ Authorization: `Bearer ${sessionToken}` }),
			});
		} catch {
			// Best-effort — don't throw if session is already invalid
		}
	}
}
