CREATE TABLE `meeting_series_containers` (
	`series_id` text PRIMARY KEY NOT NULL,
	`container_id` integer NOT NULL,
	`assigned_at` text NOT NULL,
	FOREIGN KEY (`container_id`) REFERENCES `containers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `container_id` integer REFERENCES containers(id);--> statement-breakpoint
CREATE INDEX `calendar_events_container_idx` ON `calendar_events` (`container_id`);