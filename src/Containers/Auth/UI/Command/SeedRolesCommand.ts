import { rolePermissionsTable } from "@containers/Auth/Models/permission.schema";
import { rolesTable } from "@containers/Auth/Models/role.schema";
import { ConsoleCommand } from "@ship/Console/ConsoleCommand";
import type { ConsoleContext } from "@ship/Console/ConsoleContext";
import { eq } from "drizzle-orm";

type SeedRolesInput = Record<string, never>;

const DEFAULT_ROLES: readonly { name: string; description: string }[] = [
	{ name: "admin", description: "Full administrative access." },
	{ name: "customer", description: "Default shopper account." },
	{ name: "seller", description: "Merchant account that manages catalog and orders." },
];

const DEFAULT_PERMISSIONS: Record<string, readonly { resource: string; action: string }[]> = {
	admin: [{ resource: "*", action: "*" }],
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

export class SeedRolesCommand extends ConsoleCommand<SeedRolesInput> {
	readonly signature = "db:seed:roles";
	readonly description = "Seed default RBAC roles and permissions";

	async handle(_input: SeedRolesInput, context: ConsoleContext): Promise<void> {
		const result = await context.db.transaction(async (tx) => {
			let permissionCount = 0;

			for (const roleInput of DEFAULT_ROLES) {
				const existing = await tx
					.select()
					.from(rolesTable)
					.where(eq(rolesTable.name, roleInput.name))
					.limit(1);

				const role = existing[0]
					? existing[0]
					: (await tx.insert(rolesTable).values(roleInput).returning())[0]!;

				for (const permission of DEFAULT_PERMISSIONS[roleInput.name] ?? []) {
					const permExisting = await tx
						.select({ id: rolePermissionsTable.id })
						.from(rolePermissionsTable)
						.where(eq(rolePermissionsTable.roleId, role.id))
						.limit(1);

					if (permExisting.length === 0) {
						await tx.insert(rolePermissionsTable).values({
							roleId: role.id,
							resource: permission.resource,
							action: permission.action,
						});
					}
					permissionCount += 1;
				}
			}

			return { roles: DEFAULT_ROLES.length, permissions: permissionCount };
		});

		context.log.info(result, "Roles seeded");
	}
}
