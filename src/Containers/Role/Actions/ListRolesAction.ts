import type { AppClient } from "@ship/database/connection";
import type { RawRoleEntity } from "../Models/role.schema";
import { ListRolesTask } from "../Tasks/ListRolesTask";

export class ListRolesAction {
	static async execute(dbClient: AppClient, roleName?: string): Promise<RawRoleEntity[]> {
		return await ListRolesTask.run(dbClient, roleName);
	}
}
