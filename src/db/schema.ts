import { sqliteTable, integer, text, primaryKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  ITEM_TYPES,
  ITEM_STATUSES,
  JOB_TYPES,
  JOB_STATUSES,
  CONTAINER_KINDS,
  CONTAINER_STATUSES,
  RESOURCE_CATEGORIES,
  TASK_STATUSES,
  TASK_PRIORITIES,
  MEETING_STATUSES,
  CALENDAR_SOURCES,
} from "./enums";

export { ITEM_TYPES, ITEM_STATUSES, JOB_TYPES, JOB_STATUSES, CONTAINER_KINDS, CONTAINER_STATUSES, RESOURCE_CATEGORIES, TASK_STATUSES, TASK_PRIORITIES, MEETING_STATUSES, CALENDAR_SOURCES } from "./enums";
export type { ItemType, ItemStatus, JobType, JobStatus, ContainerKind, ContainerStatus, ResourceCategory, TaskStatus, TaskPriority, MeetingStatus, CalendarSource } from "./enums";

export const containers = sqliteTable(
  "containers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: CONTAINER_KINDS }).notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description").notNull().default(""),
    status: text("status", { enum: CONTAINER_STATUSES }).notNull().default("active"),
    goal: text("goal").notNull().default(""),
    deadline: text("deadline"),
    standard: text("standard").notNull().default(""),
    category: text("category", { enum: RESOURCE_CATEGORIES }),
    nextSteps: text("next_steps").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("containers_kind_status_idx").on(t.kind, t.status)],
);

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
    containerId: integer("container_id").references(() => containers.id, { onDelete: "set null" }),
    archivedAt: text("archived_at"),
    pinned: integer("pinned").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("items_type_idx").on(t.type),
    index("items_created_idx").on(t.createdAt),
    index("items_container_idx").on(t.containerId),
    index("items_archived_idx").on(t.archivedAt),
  ],
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

export const people = sqliteTable("people", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  profile: text("profile").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const itemPeople = sqliteTable(
  "item_people",
  {
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.personId] })],
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

export const ACTIVITY_MATCH_KINDS = ["app", "domain", "title_contains"] as const;
export const ACTIVITY_EXCLUSION_KINDS = ["app", "domain"] as const;

export const activityCategories = sqliteTable("activity_categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  color: text("color").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const activityRules = sqliteTable(
  "activity_rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    matchKind: text("match_kind", { enum: ACTIVITY_MATCH_KINDS }).notNull(),
    pattern: text("pattern").notNull(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => activityCategories.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("activity_rules_order_idx").on(t.sortOrder)],
);

export const activityExclusions = sqliteTable(
  "activity_exclusions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: ACTIVITY_EXCLUSION_KINDS }).notNull(),
    pattern: text("pattern").notNull(),
  },
  (t) => [uniqueIndex("activity_exclusions_kind_pattern_unique").on(t.kind, t.pattern)],
);

export const calendarEvents = sqliteTable(
  "calendar_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    externalId: text("external_id").notNull().unique(),
    title: text("title").notNull(),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    attendees: integer("attendees").notNull().default(0),
    hasCallLink: integer("has_call_link").notNull().default(0),
    day: text("day").notNull(),
    organizer: text("organizer").notNull().default(""),
    /** JSON array of attendee display names, capped by the helper. */
    attendeeNames: text("attendee_names").notNull().default("[]"),
    location: text("location").notNull().default(""),
    joinUrl: text("join_url"),
    notes: text("notes").notNull().default(""),
    allDay: integer("all_day").notNull().default(0),
    status: text("status", { enum: MEETING_STATUSES }).notNull().default("none"),
    calendarTitle: text("calendar_title").notNull().default(""),
    /** Who wrote the row: the EventKit helper or a published calendar feed. Each source only purges its own. */
    source: text("source", { enum: CALENDAR_SOURCES }).notNull().default("eventkit"),
    /** The captured meeting item, kept across calendar refreshes. */
    itemId: integer("item_id").references(() => items.id, { onDelete: "set null" }),
    /** Person-set: do not record this meeting. Kept across calendar refreshes. */
    noRecord: integer("no_record").notNull().default(0),
  },
  (t) => [index("calendar_events_day_idx").on(t.day)],
);

export const activitySessions = sqliteTable(
  "activity_sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at").notNull(),
    closed: integer("closed").notNull().default(0),
    appId: text("app_id"),
    appName: text("app_name"),
    title: text("title"),
    url: text("url"),
    domain: text("domain"),
    categoryId: integer("category_id").references(() => activityCategories.id, { onDelete: "set null" }),
    afk: integer("afk").notNull().default(0),
    meetingId: integer("meeting_id").references(() => calendarEvents.id, { onDelete: "set null" }),
    heartbeats: integer("heartbeats").notNull().default(1),
    titleChangedAt: text("title_changed_at"),
    /** Set when a person hand-labels the category; recategorise() then leaves the row alone. */
    manual: integer("manual").notNull().default(0),
  },
  (t) => [index("activity_sessions_started_idx").on(t.startedAt), index("activity_sessions_ended_idx").on(t.endedAt)],
);

export type ActivityCategory = typeof activityCategories.$inferSelect;
export type ActivityRule = typeof activityRules.$inferSelect;
export type ActivityExclusion = typeof activityExclusions.$inferSelect;
export type ActivitySession = typeof activitySessions.$inferSelect;
export type CalendarEvent = typeof calendarEvents.$inferSelect;

export const attachments = sqliteTable(
  "attachments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("attachments_item_idx").on(t.itemId)],
);
export type Attachment = typeof attachments.$inferSelect;

export const tasks = sqliteTable(
  "tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    notes: text("notes").notNull().default(""),
    status: text("status", { enum: TASK_STATUSES }).notNull().default("open"),
    priority: text("priority", { enum: TASK_PRIORITIES }).notNull().default("normal"),
    dueDate: text("due_date"),
    containerId: integer("container_id").references(() => containers.id, { onDelete: "set null" }),
    sourceItemId: integer("source_item_id").references(() => items.id, { onDelete: "set null" }),
    recurrence: text("recurrence"),
    completedAt: text("completed_at"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("tasks_container_status_order_idx").on(t.containerId, t.status, t.sortOrder), index("tasks_status_due_idx").on(t.status, t.dueDate)],
);
export type Task = typeof tasks.$inferSelect;

export const dailyPlanEntries = sqliteTable(
  "daily_plan_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    date: text("date").notNull(),
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("daily_plan_date_task_idx").on(t.date, t.taskId), index("daily_plan_date_idx").on(t.date)],
);
export type DailyPlanEntry = typeof dailyPlanEntries.$inferSelect;

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type Chunk = typeof chunks.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type Container = typeof containers.$inferSelect;
export type NewContainer = typeof containers.$inferInsert;
export type Person = typeof people.$inferSelect;
