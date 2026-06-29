import { RegisterAction } from "@containers/Auth/Actions/RegisterAction";
import type { RegisterDTO } from "@containers/Auth/Requests/register.request";
import type { Container } from "@ship/Container/Container";
import { wrapResponse } from "@ship/Http/MainController";

export async function register(body: RegisterDTO, container: Container) {
	const action = container.make(RegisterAction);
	const result = await action.execute(body);
	return wrapResponse(result);
}
