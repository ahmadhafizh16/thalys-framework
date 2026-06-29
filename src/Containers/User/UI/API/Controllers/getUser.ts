import { UserRepository } from "@containers/User/Models/UserRepository";
import { UserTransformer } from "@containers/User/Transformers/UserTransformer";
import type { Container } from "@ship/Container/Container";
import { NotFoundError } from "@ship/Exceptions/AppError";
import { BaseRequest } from "@ship/Http/BaseRequest";
import { wrapResponse } from "@ship/Http/MainController";

const transformer = new UserTransformer();

export async function getUser(params: { id: string }, container: Container) {
	const id = BaseRequest.validateId(params.id);
	const repo = container.make(UserRepository);
	const user = await repo.findById(id);
	if (!user) throw new NotFoundError("User");
	return wrapResponse(transformer.transform(user));
}
