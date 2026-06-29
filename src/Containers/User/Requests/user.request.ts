import { type Static, t } from "elysia";

export const CreateUserRequest = t.Object({
	name: t.String({ minLength: 2 }),
	email: t.String({ format: "email" }),
	phone: t.Optional(t.String()),
	profilePic: t.Optional(t.String()),
	password: t.String({ minLength: 8 }),
	roleId: t.String({ format: "uuid" }),
});

export type CreateUserDTO = Static<typeof CreateUserRequest>;
