import { UserRepository } from "@containers/User/Models/UserRepository";
import { ListUsersRequest } from "@containers/User/Requests/list-users.request";
import { UserTransformer } from "@containers/User/Transformers/UserTransformer";
import type { Container } from "@ship/Container/Container";
import { wrapPaginated } from "@ship/Http/MainController";

const transformer = new UserTransformer();

export async function listUsers(query: Record<string, string | undefined>, container: Container) {
	const criteria = ListUsersRequest.parse(query);
	const repo = container.make(UserRepository);
	const result = await repo.paginate(criteria);
	return wrapPaginated(
		result.data.map((u) => transformer.transform(u)),
		result.meta,
	);
}
