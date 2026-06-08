import { sql } from "drizzle-orm";
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const rolesTable = pgTable("roles", {
	id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
	externalId: text("external_id")
		.notNull()
		.unique()
		.default(sql`gen_random_uuid()`),
	name: text("name").notNull().unique(),
	description: text("description").notNull(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type RawRoleEntity = typeof rolesTable.$inferSelect;
