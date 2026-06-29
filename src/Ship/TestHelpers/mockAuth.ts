import type { SessionDTO } from "@containers/AuthBridge/DTOs/AuthBridgeDTO";

let mockCounter = 0;

/**
 * Create a mock SessionDTO without hitting the database.
 * Use this when testing code that checks `ctx.currentUser` but you don't
 * need to verify the actual auth flow.
 */
export function createMockSession(overrides?: Partial<SessionDTO>): SessionDTO {
	mockCounter++;
	return {
		userId: `mock-user-${mockCounter}`,
		email: `mock-${mockCounter}@test.com`,
		name: `Mock User ${mockCounter}`,
		sessionId: `mock-session-${mockCounter}`,
		expiresAt: Date.now() + 86_400_000,
		permissions: [{ resource: "*", action: "*" }],
		...overrides,
	};
}

/**
 * Create a mock AuthBridgePort that returns a fixed session for any token.
 * Pass this to `createTestApp()` or override the container binding.
 */
export function createMockAuthBridge(session?: SessionDTO) {
	const resolved = session ?? createMockSession();
	return {
		async validateToken(_token: string) {
			return resolved;
		},
		async logout(_sessionToken: string) {
			// no-op
		},
	};
}
