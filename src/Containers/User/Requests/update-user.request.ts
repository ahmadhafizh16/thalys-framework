import { type Static, t } from "elysia";

export const UpdateUserRequest = t.Object({
	name: t.Optional(t.String({ minLength: 2 })),
	phone: t.Optional(t.Nullable(t.String())),
	profilePic: t.Optional(t.Nullable(t.String())),
	roleId: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
});

export type UpdateUserDTO = Static<typeof UpdateUserRequest>;
