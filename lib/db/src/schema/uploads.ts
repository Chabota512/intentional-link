import { pgTable, text, integer, timestamp, uuid } from "drizzle-orm/pg-core";
import { customType } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
  toDriver(value: Buffer) {
    return value;
  },
  fromDriver(value: unknown) {
    return value as Buffer;
  },
});

export const uploadsTable = pgTable("uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  data: bytea("data").notNull(),
  contentType: text("content_type").notNull(),
  filename: text("filename").notNull(),
  fileSize: integer("file_size").notNull(),
  uploadedBy: integer("uploaded_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Upload = typeof uploadsTable.$inferSelect;
