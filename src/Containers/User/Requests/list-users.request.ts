import { type Allowlist, BaseRequest } from "@ship/Http/BaseRequest";

export class ListUsersRequest extends BaseRequest {
	protected static readonly allowlist: Allowlist = {
		filterable: ["roleId", "email"],
		sortable: ["name", "createdAt"],
		defaultSort: { field: "createdAt", direction: "desc" },
		defaultLimit: 20,
		maxLimit: 100,
	};

	static parse(raw: Record<string, string | undefined>) {
		return this.parseQuery(raw, this.allowlist);
	}
}
