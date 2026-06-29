import { rolesTable } from "@containers/Auth/Models/role.schema";
import { BaseAction } from "@ship/Actions/BaseAction";
import { eq } from "drizzle-orm";

export interface RoleSummary {
	id: string;
	name: string;
}

export class ListRolesAction extends BaseAction {
	async execute(): Promise<RoleSummary[]> {
		return await this.db.select({ id: rolesTable.id, name: rolesTable.name }).from(rolesTable);
	}

	async executeByName(name: string): Promise<RoleSummary[]> {
		return await this.db
			.select({ id: rolesTable.id, name: rolesTable.name })
			.from(rolesTable)
			.where(eq(rolesTable.name, name));
	}
}
