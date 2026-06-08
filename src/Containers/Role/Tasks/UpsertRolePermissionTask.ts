import { and, eq } from "drizzle-orm";
import type { AppClient } from "@ship/database/connection";
import { rolePermissionsTable } from "../Models/permission.schema";

export interface PermissionSeedInput {
	roleId: number;
	resource: string;
	action: string;
}

export class UpsertRolePermissionTask {
	static async run(dbClient: AppClient, permission: PermissionSeedInput): Promise<void> {
		const existing = await dbClient
			.select({ id: rolePermissionsTable.id })
			.from(rolePermissionsTable)
			.where(
				and(
					eq(rolePermissionsTable.roleId, permission.roleId),
					eq(rolePermissionsTable.resource, permission.resource),
					eq(rolePermissionsTable.action, permission.action),
				),
			)
			.limit(1);

		if (existing.length > 0) {
			return;
		}

		await dbClient.insert(rolePermissionsTable).values(permission);
	}
}
