import { sqliteTable, integer, text, primaryKey, index } from "drizzle-orm/sqlite-core";
import { ITEM_TYPES, ITEM_STATUSES, JOB_TYPES, JOB_STATUSES } from "./enums";

export { ITEM_TYPES, ITEM_STATUSES, JOB_TYPES, JOB_STATUSES } from "./enums";
export type { ItemType, ItemStatus, JobType, JobStatus } from "./enums";

export const items = sqliteTable(
  "items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type", { enum: ITEM_TYPES }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    status: text("status", { enum: ITEM_STATUSES }).notNull().default("pending"),
    error: text("error"),
    sourceUrl: text("source_url"),
    filePath: text("file_path"),
    mimeType: text("mime_type"),
    extractedText: text("extracted_text").notNull().default(""),
    meta: text("meta").notNull().default("{}"),
    journalDate: text("journal_date").unique(),
    reviewWeek: text("review_week").unique(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("items_type_idx").on(t.type), index("items_created_idx").on(t.createdAt)],
);

export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
});

export const itemTags = sqliteTable(
  "item_tags",
  {
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.tagId] })],
);

export const chunks = sqliteTable(
  "chunks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    text: text("text").notNull(),
  },
  (t) => [index("chunks_item_idx").on(t.itemId)],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    type: text("type", { enum: JOB_TYPES }).notNull(),
    payload: text("payload").notNull().default("{}"),
    status: text("status", { enum: JOB_STATUSES }).notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    runAfter: text("run_after").notNull(),
    itemId: integer("item_id").references(() => items.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("jobs_status_run_idx").on(t.status, t.runAfter)],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type Chunk = typeof chunks.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Tag = typeof tags.$inferSelect;
