import { UpdateUserAction, type UpdateUserInput } from "@containers/User/Actions/UpdateUserAction";
import type { UpdateUserDTO } from "@containers/User/Requests/update-user.request";
import { UserTransformer } from "@containers/User/Transformers/UserTransformer";
import type { Container } from "@ship/Container/Container";
import { BaseRequest } from "@ship/Http/BaseRequest";
import { wrapResponse } from "@ship/Http/MainController";

const transformer = new UserTransformer();

export async function updateUser(
	params: { id: string },
	body: UpdateUserDTO,
	container: Container,
) {
	const id = BaseRequest.validateId(params.id);
	const input: UpdateUserInput = { id, ...body };
	const action = container.make(UpdateUserAction);
	const updated = await action.execute(input);
	return wrapResponse(transformer.transform(updated));
}
