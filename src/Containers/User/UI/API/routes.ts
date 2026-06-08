import { Elysia } from "elysia";
import { shipContext } from "@ship/setup";
import { CreateUserAction } from "../../Actions/CreateUserAction";
import { CreateUserRequest } from "../../Requests/user.request";

export const userRoutes = new Elysia({ prefix: "/api/v1/users" })
	.use(shipContext)
	.post(
		"/",
		async ({ db, body }) => {
			return await CreateUserAction.execute(db, body);
		},
		{
			body: CreateUserRequest,
		},
	);
