import { rolePermissionsTable } from "@containers/Auth/Models/permission.schema";
import { usersTable } from "@containers/User/Models/user.schema";
import type { AppClient } from "@ship/database/connection";
import { eq } from "drizzle-orm";

export interface PermissionEntry {
	resource: string;
	action: string;
}

export class GetUserPermissionsTask {
	constructor(private readonly dbClient: AppClient) {}

	async run(userId: string): Promise<PermissionEntry[]> {
		const rows = await this.dbClient
			.select({
				resource: rolePermissionsTable.resource,
				action: rolePermissionsTable.action,
			})
			.from(rolePermissionsTable)
			.innerJoin(usersTable, eq(usersTable.roleId, rolePermissionsTable.roleId))
			.where(eq(usersTable.id, userId));

		return rows;
	}
}
