CREATE TABLE `containers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`goal` text DEFAULT '' NOT NULL,
	`deadline` text,
	`standard` text DEFAULT '' NOT NULL,
	`category` text,
	`next_steps` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `containers_slug_unique` ON `containers` (`slug`);--> statement-breakpoint
CREATE INDEX `containers_kind_status_idx` ON `containers` (`kind`,`status`);--> statement-breakpoint
CREATE TABLE `item_people` (
	`item_id` integer NOT NULL,
	`person_id` integer NOT NULL,
	PRIMARY KEY(`item_id`, `person_id`),
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `people` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`profile` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `people_slug_unique` ON `people` (`slug`);--> statement-breakpoint
ALTER TABLE `items` ADD `container_id` integer REFERENCES containers(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `items` ADD `archived_at` text;--> statement-breakpoint
CREATE INDEX `items_container_idx` ON `items` (`container_id`);--> statement-breakpoint
CREATE INDEX `items_archived_idx` ON `items` (`archived_at`);