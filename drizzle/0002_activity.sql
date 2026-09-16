CREATE TABLE `activity_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_categories_name_unique` ON `activity_categories` (`name`);--> statement-breakpoint
CREATE TABLE `activity_exclusions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`pattern` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_exclusions_kind_pattern_unique` ON `activity_exclusions` (`kind`,`pattern`);--> statement-breakpoint
CREATE TABLE `activity_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_kind` text NOT NULL,
	`pattern` text NOT NULL,
	`category_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `activity_categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `activity_rules_order_idx` ON `activity_rules` (`sort_order`);--> statement-breakpoint
CREATE TABLE `activity_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text NOT NULL,
	`closed` integer DEFAULT 0 NOT NULL,
	`app_id` text,
	`app_name` text,
	`title` text,
	`url` text,
	`domain` text,
	`category_id` integer,
	`afk` integer DEFAULT 0 NOT NULL,
	`meeting_id` integer,
	`heartbeats` integer DEFAULT 1 NOT NULL,
	`title_changed_at` text,
	FOREIGN KEY (`category_id`) REFERENCES `activity_categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`meeting_id`) REFERENCES `calendar_events`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `activity_sessions_started_idx` ON `activity_sessions` (`started_at`);--> statement-breakpoint
CREATE INDEX `activity_sessions_ended_idx` ON `activity_sessions` (`ended_at`);--> statement-breakpoint
CREATE TABLE `calendar_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`attendees` integer DEFAULT 0 NOT NULL,
	`has_call_link` integer DEFAULT 0 NOT NULL,
	`day` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_events_external_id_unique` ON `calendar_events` (`external_id`);--> statement-breakpoint
CREATE INDEX `calendar_events_day_idx` ON `calendar_events` (`day`);
--> statement-breakpoint
INSERT INTO `activity_categories` (`name`,`color`,`sort_order`) VALUES ('Coding','#4cc9ff',0),('Meetings','#f5c451',1),('Communication','#52d38a',2),('Browsing','#9b9ba4',3),('Writing','#c084fc',4),('Leisure','#ff5c6c',5),('Other','#62626b',6);--> statement-breakpoint
INSERT INTO `activity_rules` (`match_kind`,`pattern`,`category_id`,`sort_order`) VALUES
('app','com.microsoft.VSCode',1,0),('app','com.apple.Terminal',1,1),('app','com.googlecode.iterm2',1,2),('app','dev.warp.Warp-Stable',1,3),
('domain','github.com',1,4),('domain','gitlab.com',1,5),
('app','us.zoom.xos',2,6),('app','com.microsoft.teams2',2,7),('app','com.webex.meetingmanager',2,8),
('domain','meet.google.com',2,9),('domain','zoom.us',2,10),
('app','com.tinyspeck.slackmacgap',3,11),('app','com.apple.mail',3,12),('app','com.apple.MobileSMS',3,13),('app','com.hnc.Discord',3,14),
('domain','mail.google.com',3,15),('domain','slack.com',3,16),
('app','com.apple.Notes',5,17),('app','md.obsidian',5,18),('app','com.apple.iWork.Pages',5,19),
('domain','youtube.com',6,20),('domain','netflix.com',6,21),('domain','reddit.com',6,22),('domain','twitter.com',6,23),('domain','x.com',6,24),
('app','com.apple.Safari',4,25),('app','com.google.Chrome',4,26),('app','company.thebrowser.Browser',4,27),('app','com.brave.Browser',4,28),('app','com.microsoft.edgemac',4,29);--> statement-breakpoint
INSERT INTO `activity_exclusions` (`kind`,`pattern`) VALUES
('app','com.1password.1password'),('app','com.agilebits.onepassword7'),('app','com.bitwarden.desktop'),('app','com.apple.keychainaccess'),
('domain','*.bank'),('domain','chase.com'),('domain','bankofamerica.com'),('domain','wellsfargo.com'),('domain','paypal.com'),('domain','accounts.google.com'),('domain','login.microsoftonline.com');
