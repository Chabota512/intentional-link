import { pgTable, text, integer, serial, timestamp, unique, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const sessionsTable = pgTable("sessions", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  creatorId: integer("creator_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["active", "completed"] }).notNull().default("active"),
  showPastMessages: boolean("show_past_messages").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const sessionParticipantsTable = pgTable("session_participants", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["invited", "joined", "declined"] }).notNull().default("invited"),
  joinedAt: timestamp("joined_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessionReadCursorsTable = pgTable("session_read_cursors", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  lastReadMessageId: integer("last_read_message_id").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique().on(t.sessionId, t.userId),
]);

export const insertSessionSchema = createInsertSchema(sessionsTable).omit({ id: true, createdAt: true, endedAt: true });
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessionsTable.$inferSelect;

export const pendingInvitesTable = pgTable("pending_invites", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
  invitedUserId: integer("invited_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  requestedByUserId: integer("requested_by_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  approvedByUserId: integer("approved_by_user_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertParticipantSchema = createInsertSchema(sessionParticipantsTable).omit({ id: true, createdAt: true });
export type InsertParticipant = z.infer<typeof insertParticipantSchema>;
export type SessionParticipant = typeof sessionParticipantsTable.$inferSelect;
