CREATE TABLE `goal_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`goal_id` integer NOT NULL,
	`container_id` integer NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`container_id`) REFERENCES `containers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `goal_links_pair_idx` ON `goal_links` (`goal_id`,`container_id`);--> statement-breakpoint
CREATE INDEX `goal_links_container_idx` ON `goal_links` (`container_id`);--> statement-breakpoint
CREATE TABLE `goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`outcome` text DEFAULT '' NOT NULL,
	`horizon` text NOT NULL,
	`target_date` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`closed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `goals_status_target_idx` ON `goals` (`status`,`target_date`);