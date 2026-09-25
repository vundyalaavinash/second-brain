ALTER TABLE `tasks` ADD `dropped_at` text;--> statement-breakpoint
UPDATE tasks SET dropped_at = updated_at WHERE status = 'dropped' AND dropped_at IS NULL;
