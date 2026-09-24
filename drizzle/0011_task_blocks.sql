CREATE TABLE `task_blocks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`starts_at` text NOT NULL,
	`minutes` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `task_blocks` (`task_id`, `starts_at`, `minutes`)
SELECT `id`, `scheduled_at`, COALESCE(`estimate_minutes`, 25) FROM `tasks` WHERE `scheduled_at` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `task_blocks_task_idx` ON `task_blocks` (`task_id`);--> statement-breakpoint
CREATE INDEX `task_blocks_start_idx` ON `task_blocks` (`starts_at`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `session_minutes` integer;--> statement-breakpoint
ALTER TABLE `tasks` DROP COLUMN `scheduled_at`;