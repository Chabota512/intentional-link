import { pgTable, text, integer, serial, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["message", "call", "invite", "contact_request", "contact_accepted", "dnd_ending", "chat_completed"] }).notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>(),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Notification = typeof notificationsTable.$inferSelect;
