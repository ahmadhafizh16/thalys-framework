import { UpdateUserRequest } from "@containers/User/Requests/update-user.request";
import { CreateUserRequest } from "@containers/User/Requests/user.request";
import { createUser } from "@containers/User/UI/API/Controllers/createUser";
import { deleteUser } from "@containers/User/UI/API/Controllers/deleteUser";
import { getUser } from "@containers/User/UI/API/Controllers/getUser";
import { listUsers } from "@containers/User/UI/API/Controllers/listUsers";
import { updateUser } from "@containers/User/UI/API/Controllers/updateUser";
import type { Container } from "@ship/Container/Container";
import { can } from "@ship/Http/canMiddleware";
import { routeGroup } from "@ship/Http/routeGroup";

export const userRoutesV1 = routeGroup("/v1/users")
	.post(
		"/",
		async ({ container, body, set }) => {
			set.status = 201;
			return createUser(body, container as Container);
		},
		{ body: CreateUserRequest },
	)
	.get("/", async ({ container, query }) => listUsers(query, container as Container), {
		beforeHandle: [can("user", "read")],
	})
	.get("/:id", async ({ container, params }) => getUser(params, container as Container), {
		beforeHandle: [can("user", "read")],
	})
	.patch(
		"/:id",
		async ({ container, params, body }) => updateUser(params, body, container as Container),
		{ body: UpdateUserRequest, beforeHandle: [can("user", "update")] },
	)
	.delete("/:id", async ({ container, params }) => deleteUser(params, container as Container), {
		beforeHandle: [can("user", "delete")],
	});
