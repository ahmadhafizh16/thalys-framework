import { CreateUserAction } from "@containers/User/Actions/CreateUserAction";
import type { CreateUserDTO } from "@containers/User/Requests/user.request";
import { UserTransformer } from "@containers/User/Transformers/UserTransformer";
import type { Container } from "@ship/Container/Container";
import { wrapResponse } from "@ship/Http/MainController";

const transformer = new UserTransformer();

export async function createUser(body: CreateUserDTO, container: Container) {
	const action = container.make(CreateUserAction);
	const created = await action.execute(body);
	return wrapResponse(transformer.transform(created));
}
