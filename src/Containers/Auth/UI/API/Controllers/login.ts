import { LoginAction } from "@containers/Auth/Actions/LoginAction";
import type { LoginDTO } from "@containers/Auth/Requests/login.request";
import type { Container } from "@ship/Container/Container";
import { wrapResponse } from "@ship/Http/MainController";

export async function login(body: LoginDTO, container: Container) {
	const action = container.make(LoginAction);
	const result = await action.execute(body);
	return wrapResponse(result);
}
