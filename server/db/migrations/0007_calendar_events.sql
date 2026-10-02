CREATE TABLE `calendar_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`start` integer,
	`end` integer,
	`title` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `calendar_events_date` ON `calendar_events` (`date`);