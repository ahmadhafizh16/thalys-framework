import { type Static, t } from "elysia";

export const RegisterRequest = t.Object({
	name: t.String({ minLength: 2 }),
	email: t.String({ format: "email" }),
	password: t.String({ minLength: 8 }),
});

export type RegisterDTO = Static<typeof RegisterRequest>;
