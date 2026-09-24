CREATE TABLE `focus_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
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
CREATE INDEX `focus_runs_task_idx` ON `focus_runs` (`task_id`);--> statement-breakpoint
CREATE INDEX `focus_runs_started_idx` ON `focus_runs` (`started_at`);