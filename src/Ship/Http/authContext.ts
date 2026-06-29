import type { AuthBridgePort } from "@containers/AuthBridge/Adapters/InProcessAuthBridgeAdapter";
import type { SessionDTO } from "@containers/AuthBridge/DTOs/AuthBridgeDTO";
import type { Container } from "@ship/Container/Container";
import { Elysia } from "elysia";
import { extractToken } from "./authMiddleware";

export const authContext = new Elysia({ name: "auth-context" }).derive(
	{ as: "scoped" },
	async (ctx) => {
		const token = extractToken(ctx.request);
		if (!token) return { currentUser: undefined as SessionDTO | undefined };

		const container = (ctx as unknown as { container: Container }).container;
		const authBridge = container.make<AuthBridgePort>("AuthBridgePort");
		const session = await authBridge.validateToken(token);
		return { currentUser: session ?? (undefined as SessionDTO | undefined) };
	},
);
