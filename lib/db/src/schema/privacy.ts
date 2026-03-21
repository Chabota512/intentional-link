import { pgTable, text, integer, serial, timestamp, boolean, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const userDndSettingsTable = pgTable("user_dnd_settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }).unique(),
  isDndActive: boolean("is_dnd_active").notNull().default(false),
  scheduledStartTime: text("scheduled_start_time"),
  scheduledEndTime: text("scheduled_end_time"),
  scheduledDays: text("scheduled_days").array(),
  notificationVolume: integer("notification_volume").notNull().default(100),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dndWhitelistTable = pgTable("dnd_whitelist", {
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  contactUserId: integer("contact_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
}, (t) => [
  unique().on(t.userId, t.contactUserId),
]);

export type UserDndSettings = typeof userDndSettingsTable.$inferSelect;
export type DndWhitelistEntry = typeof dndWhitelistTable.$inferSelect;

export const userPrivacySettingsTable = pgTable("user_privacy_settings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }).unique(),
  presenceVisibility: text("presence_visibility", { enum: ["all", "specific", "none"] }).notNull().default("all"),
  readReceiptsEnabled: boolean("read_receipts_enabled").notNull().default(true),
  offlineThresholdMinutes: integer("offline_threshold_minutes").notNull().default(5),
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
