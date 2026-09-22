ALTER TABLE `calendar_events` ADD `organizer` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `attendee_names` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `location` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `join_url` text;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `notes` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `all_day` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `calendar_title` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `item_id` integer REFERENCES `items`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `no_record` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE `daily_plan_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`task_id` integer NOT NULL REFERENCES `tasks`(`id`) ON DELETE CASCADE,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_plan_date_task_idx` ON `daily_plan_entries` (`date`,`task_id`);--> statement-breakpoint
CREATE INDEX `daily_plan_date_idx` ON `daily_plan_entries` (`date`);
