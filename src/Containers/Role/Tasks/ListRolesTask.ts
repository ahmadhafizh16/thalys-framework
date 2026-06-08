import { eq } from "drizzle-orm";
import type { AppClient } from "@ship/database/connection";
import { rolesTable, type RawRoleEntity } from "../Models/role.schema";

export class ListRolesTask {
	static async run(dbClient: AppClient, roleName?: string): Promise<RawRoleEntity[]> {
		if (!roleName) {
			return await dbClient.select().from(rolesTable);
		}

		return await dbClient.select().from(rolesTable).where(eq(rolesTable.name, roleName));
	}
}
