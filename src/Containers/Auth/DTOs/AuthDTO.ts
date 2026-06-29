export interface LoginInput {
	email: string;
	password: string;
}

export interface RegisterInput {
	name: string;
	email: string;
	password: string;
	roleId?: string;
}

export interface AuthSessionDTO {
	userId: string;
	email: string;
	name: string;
	sessionId: string;
	expiresAt: number;
}
