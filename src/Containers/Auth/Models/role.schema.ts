import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

export const rolesTable = pgTable("roles", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => uuidv7()),
	name: text("name").notNull().unique(),
	description: text("description").notNull(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type RawRoleEntity = typeof rolesTable.$inferSelect;
