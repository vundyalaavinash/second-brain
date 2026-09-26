CREATE TABLE `meeting_series_decisions` (
	`series_id` text PRIMARY KEY NOT NULL,
	`decision` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`decided_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `series_id` text;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `decision` text;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `decision_note` text DEFAULT '' NOT NULL;