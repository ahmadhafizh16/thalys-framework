export interface PermissionEntry {
	resource: string;
	action: string;
}

export interface SessionDTO {
	userId: string;
	email: string;
	name: string;
	sessionId: string;
	expiresAt: number;
	permissions: PermissionEntry[];
}
