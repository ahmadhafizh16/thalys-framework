import { LogoutAction } from "@containers/Auth/Actions/LogoutAction";
import type { Container } from "@ship/Container/Container";
import { AppError } from "@ship/Exceptions/AppError";
import { wrapResponse } from "@ship/Http/MainController";
import { extractToken } from "@ship/Http/authMiddleware";

export async function logout(request: Request, container: Container) {
	const token = extractToken(request);
	if (!token) throw new AppError(401, "UNAUTHORIZED", "No session token provided.");
	const action = container.make(LogoutAction);
	await action.execute(token);
	return wrapResponse({ success: true });
}
