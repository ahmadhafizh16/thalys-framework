import { DeleteUserAction } from "@containers/User/Actions/DeleteUserAction";
import type { Container } from "@ship/Container/Container";
import { BaseRequest } from "@ship/Http/BaseRequest";
import { wrapResponse } from "@ship/Http/MainController";

export async function deleteUser(params: { id: string }, container: Container) {
	const id = BaseRequest.validateId(params.id);
	const action = container.make(DeleteUserAction);
	await action.execute(id);
	return wrapResponse({ success: true });
}
