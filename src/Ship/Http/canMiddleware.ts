import type { SessionDTO } from "@containers/AuthBridge/DTOs/AuthBridgeDTO";
import { AppError } from "@ship/Exceptions/AppError";
import { hasPermission } from "./permissionCheck";

export class ForbiddenError extends AppError {
	constructor(message = "You do not have permission to perform this action.") {
		super(403, "FORBIDDEN", message);
	}
}

interface AuthedContext {
	currentUser?: SessionDTO;
}

export function can(resource: string, action: string) {
	return (ctx: AuthedContext & Record<string, unknown>) => {
		if (!ctx.currentUser) {
			throw new ForbiddenError("Authentication required.");
		}

		const userPermissions = ctx.currentUser.permissions ?? [];
		if (!hasPermission(userPermissions, { resource, action })) {
			throw new ForbiddenError();
		}
	};
}
