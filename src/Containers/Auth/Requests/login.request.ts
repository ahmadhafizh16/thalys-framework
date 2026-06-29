import { type Static, t } from "elysia";

export const LoginRequest = t.Object({
	email: t.String({ format: "email" }),
	password: t.String({ minLength: 1 }),
});

export type LoginDTO = Static<typeof LoginRequest>;
