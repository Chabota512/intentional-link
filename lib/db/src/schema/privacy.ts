import { pgTable, text, integer, serial, timestamp, boolean, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const userPrivacySettingsTable = pgTable("user_privacy_settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }).unique(),
  presenceVisibility: text("presence_visibility", { enum: ["all", "specific", "none"] }).notNull().default("all"),
  readReceiptsEnabled: boolean("read_receipts_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const presenceWhitelistTable = pgTable("presence_whitelist", {
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  allowedContactId: integer("allowed_contact_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
}, (t) => [
  unique().on(t.userId, t.allowedContactId),
]);

export type UserPrivacySettings = typeof userPrivacySettingsTable.$inferSelect;
export type PresenceWhitelistEntry = typeof presenceWhitelistTable.$inferSelect;
