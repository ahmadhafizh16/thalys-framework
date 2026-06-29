import { AppError } from "@ship/Exceptions/AppError";
import type { AuthSessionDTO, RegisterInput } from "../DTOs/AuthDTO";
import type { auth } from "../betterAuth.config";

export class RegisterTask {
	constructor(private readonly authInstance: typeof auth) {}

	async run(input: RegisterInput): Promise<{ session: AuthSessionDTO; token: string }> {
		const result = await this.authInstance.api.signUpEmail({
			body: {
				email: input.email,
				password: input.password,
				name: input.name,
			},
		});

		if (!result || !result.token) {
			throw new AppError(409, "REGISTRATION_FAILED", "Could not create account.");
		}

		const sessionResult = await this.authInstance.api.getSession({
			headers: new Headers({ Authorization: `Bearer ${result.token}` }),
		});

		if (!sessionResult) {
			throw new AppError(409, "REGISTRATION_FAILED", "Session could not be established.");
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
