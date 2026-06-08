import type { AppDB } from "@ship/database/connection";
import { UpsertRolePermissionTask } from "../Tasks/UpsertRolePermissionTask";
import { UpsertRoleTask, type RoleSeedInput } from "../Tasks/UpsertRoleTask";

const DEFAULT_ROLES: readonly RoleSeedInput[] = [
	{ name: "admin", description: "Full administrative access." },
	{ name: "customer", description: "Default shopper account." },
	{ name: "seller", description: "Merchant account that manages catalog and orders." },
];

const DEFAULT_PERMISSIONS: Record<string, readonly { resource: string; action: string }[]> = {
	admin: [
		{ resource: "*", action: "*" },
	],
	customer: [
		{ resource: "profile", action: "read" },
		{ resource: "profile", action: "update" },
		{ resource: "order", action: "read" },
	],
	seller: [
		{ resource: "product", action: "create" },
		{ resource: "product", action: "read" },
		{ resource: "product", action: "update" },
		{ resource: "order", action: "read" },
		{ resource: "order", action: "update" },
	],
};

export interface SeedRolesResult {
	roles: number;
	permissions: number;
}

export class SeedRolesAction {
	static async execute(db: AppDB): Promise<SeedRolesResult> {
		return await db.transaction(async (tx) => {
			let permissionCount = 0;

			for (const roleInput of DEFAULT_ROLES) {
				const role = await UpsertRoleTask.run(tx, roleInput);
				for (const permission of DEFAULT_PERMISSIONS[roleInput.name] ?? []) {
					await UpsertRolePermissionTask.run(tx, {
						roleId: role.id,
						resource: permission.resource,
						action: permission.action,
					});
					permissionCount += 1;
				}
			}

			return { roles: DEFAULT_ROLES.length, permissions: permissionCount };
		});
	}
}
