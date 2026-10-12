-- A pomodoro can now be started without a task: `focus_runs.task_id` becomes nullable.
--
-- Not every stretch of focused work is about something already written down. Requiring a task
-- meant the timer could not be started at all on a day that had not been planned, which is the
-- one time somebody most wants to just start.
--
-- SQLite cannot drop a NOT NULL, so the table is rebuilt. Everything else is carried over
-- exactly: both foreign keys with their original actions, and all three indexes including the
-- partial unique index that enforces one live run at a time.
--
-- No `PRAGMA foreign_keys` dance: these run inside a transaction, where that pragma is a no-op,
-- and nothing in the schema references `focus_runs` -- it is the table holding the references, so
-- replacing it breaks nothing pointing at it.
CREATE TABLE `focus_runs_new` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer,
	`block_id` integer,
	`started_at` text NOT NULL,
	`ended_at` text,
	`planned_minutes` integer NOT NULL,
	`actual_minutes` integer,
	`outcome` text,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`block_id`) REFERENCES `task_blocks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `focus_runs_new` (`id`, `task_id`, `block_id`, `started_at`, `ended_at`, `planned_minutes`, `actual_minutes`, `outcome`) SELECT `id`, `task_id`, `block_id`, `started_at`, `ended_at`, `planned_minutes`, `actual_minutes`, `outcome` FROM `focus_runs`;
--> statement-breakpoint
DROP TABLE `focus_runs`;
--> statement-breakpoint
ALTER TABLE `focus_runs_new` RENAME TO `focus_runs`;
--> statement-breakpoint
CREATE INDEX `focus_runs_task_idx` ON `focus_runs` (`task_id`);
--> statement-breakpoint
CREATE INDEX `focus_runs_started_idx` ON `focus_runs` (`started_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `focus_runs_one_live_idx` ON `focus_runs` ((ended_at is null)) WHERE "focus_runs"."ended_at" is null;
