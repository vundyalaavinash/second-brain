-- The prediction log: a call written down before the answer is known.
--
-- Hand-trimmed. `drizzle-kit generate` also emitted a rebuild of `focus_runs` here, because
-- migration 0020 made `task_id` nullable by hand and never updated the snapshot, so this diff
-- was the first to notice. Its replay was both redundant and broken -- it re-created the
-- partial unique index with the expression quoted as a column name, which SQLite rejects.
-- 0021's snapshot now records the nullable column, so later diffs start from the truth.
CREATE TABLE `predictions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`claim` text NOT NULL,
	`container_id` integer,
	`task_id` integer,
	`item_id` integer,
	`unit` text,
	`p50_low` real,
	`p50_high` real,
	`p90_low` real,
	`p90_high` real,
	`actual` real,
	`probability` real,
	`outcome` integer,
	`resolve_by` text NOT NULL,
	`resolved_at` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`container_id`) REFERENCES `containers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `predictions_kind_idx` ON `predictions` (`kind`);--> statement-breakpoint
CREATE INDEX `predictions_open_idx` ON `predictions` (`resolved_at`,`resolve_by`);--> statement-breakpoint
CREATE INDEX `predictions_created_idx` ON `predictions` (`created_at`);
