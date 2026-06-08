import { sql } from "drizzle-orm";
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
	id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
	externalId: text("external_id")
		.notNull()
		.unique()
		.default(sql`gen_random_uuid()`),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	phone: text("phone"),
	profilePic: text("profile_pic"),
	passwordHash: text("password_hash").notNull(),
	roleId: integer("role_id").notNull(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type RawUserEntity = typeof usersTable.$inferSelect;
