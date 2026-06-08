import { sql } from "drizzle-orm";
import { integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

export const rolePermissionsTable = pgTable(
	"role_permissions",
	{
		id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
		externalId: text("external_id")
			.notNull()
			.unique()
			.default(sql`gen_random_uuid()`),
		roleId: integer("role_id").notNull(),
		resource: text("resource").notNull(),
		action: text("action").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => ({
		roleResourceActionUnique: unique("role_resource_action_unique").on(
			t.roleId,
			t.resource,
			t.action,
		),
	}),
);

export type RawPermissionEntity = typeof rolePermissionsTable.$inferSelect;
