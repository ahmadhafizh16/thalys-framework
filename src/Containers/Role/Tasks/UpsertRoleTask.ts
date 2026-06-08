import { eq } from "drizzle-orm";
import type { AppClient } from "@ship/database/connection";
import { rolesTable, type RawRoleEntity } from "../Models/role.schema";

export interface RoleSeedInput {
	name: string;
	description: string;
}

export class UpsertRoleTask {
	static async run(dbClient: AppClient, role: RoleSeedInput): Promise<RawRoleEntity> {
		const existing = await dbClient
			.select()
			.from(rolesTable)
			.where(eq(rolesTable.name, role.name))
			.limit(1);

		const current = existing[0];
		if (current) {
			const updated = await dbClient
				.update(rolesTable)
				.set({ description: role.description })
				.where(eq(rolesTable.id, current.id))
				.returning();

			const row = updated[0];
			if (!row) {
				throw new Error(`Failed to update role '${role.name}'.`);
			}
			return row;
		}

		const inserted = await dbClient.insert(rolesTable).values(role).returning();
		const row = inserted[0];
		if (!row) {
			throw new Error(`Failed to insert role '${role.name}'.`);
		}
		return row;
	}
}
