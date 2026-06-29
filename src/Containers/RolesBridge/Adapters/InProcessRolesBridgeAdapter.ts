import type { ListRolesAction } from "@containers/Auth/Actions/ListRolesAction";
import type { RoleSummary } from "@containers/Auth/Actions/ListRolesAction";

export interface RolesBridgePort {
	getAll(): Promise<RoleSummary[]>;
	getByName(name: string): Promise<RoleSummary[]>;
}

export class InProcessRolesBridgeAdapter implements RolesBridgePort {
	constructor(private readonly listRolesAction: ListRolesAction) {}

	async getAll(): Promise<RoleSummary[]> {
		return this.listRolesAction.execute();
	}

	async getByName(name: string): Promise<RoleSummary[]> {
		return this.listRolesAction.executeByName(name);
	}
}
