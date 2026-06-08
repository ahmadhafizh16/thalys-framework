import { sql } from "drizzle-orm";
import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const notificationsTable = pgTable("notifications", {
	id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
	externalId: text("external_id")
		.notNull()
		.unique()
		.default(sql`gen_random_uuid()`),
	userId: integer("user_id").notNull(),
	type: text("type").notNull(),
	title: text("title").notNull(),
	message: text("message").notNull(),
	isRead: boolean("is_read").notNull().default(false),
	createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type RawNotificationEntity = typeof notificationsTable.$inferSelect;
