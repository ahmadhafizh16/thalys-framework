import type { AuthBridgePort } from "@containers/AuthBridge/Adapters/InProcessAuthBridgeAdapter";
import type { SessionDTO } from "@containers/AuthBridge/DTOs/AuthBridgeDTO";

export function extractToken(request: Request): string | null {
	const authHeader = request.headers.get("authorization");
	if (authHeader?.startsWith("Bearer ")) {
		return authHeader.slice(7);
	}
	const cookies = request.headers.get("cookie");
	if (cookies) {
		const match = cookies.match(/session_token=([^;]+)/);
		if (match) return match[1]!;
	}
	return null;
}

export function authMiddleware(authBridge: AuthBridgePort) {
	return async (ctx: { request: Request; currentUser?: SessionDTO }) => {
		const token = extractToken(ctx.request);
		if (!token) return;

		const session = await authBridge.validateToken(token);
		if (session) {
			ctx.currentUser = session;
		}
	};
}
