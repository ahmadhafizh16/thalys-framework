import { AppError } from "@ship/Exceptions/AppError";
import type { AuthSessionDTO, LoginInput } from "../DTOs/AuthDTO";
import type { auth } from "../betterAuth.config";

export class LoginTask {
	constructor(private readonly authInstance: typeof auth) {}

	async run(input: LoginInput): Promise<{ session: AuthSessionDTO; token: string }> {
		const result = await this.authInstance.api.signInEmail({
			body: { email: input.email, password: input.password },
		});

		if (!result || !result.token) {
			throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
		}

		const sessionResult = await this.authInstance.api.getSession({
			headers: new Headers({ Authorization: `Bearer ${result.token}` }),
		});

		if (!sessionResult) {
			throw new AppError(401, "INVALID_CREDENTIALS", "Session could not be established.");
		}

		const session: AuthSessionDTO = {
			userId: sessionResult.user.id,
			email: sessionResult.user.email,
			name: sessionResult.user.name,
			sessionId: sessionResult.session.id,
			expiresAt: sessionResult.session.expiresAt.getTime(),
		};
		return { session, token: result.token };
	}
}
