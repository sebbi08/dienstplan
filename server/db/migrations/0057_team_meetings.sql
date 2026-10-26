CREATE TABLE `team_meetings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`group_id` integer,
	`form_id` integer NOT NULL,
	`date` text NOT NULL,
	`start` integer,
	`participants` text DEFAULT '' NOT NULL,
	`recorder` text DEFAULT '' NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`released_at` text,
	`released_by` text,
	`reopen_reason` text,
	`reopened_at` text,
	`reopened_by` text,
	`created_at` text NOT NULL,
	`created_by` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `team_meetings_facility_date` ON `team_meetings` (`facility_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `team_meetings_form` ON `team_meetings` (`form_id`);