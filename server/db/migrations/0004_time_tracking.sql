CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `time_record_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`date` text NOT NULL,
	`record_id` integer,
	`before` text NOT NULL,
	`after` text NOT NULL,
	`actor_id` integer,
	`at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `time_record_changes_employee_date` ON `time_record_changes` (`employee_id`,`date`);--> statement-breakpoint
CREATE TABLE `time_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`date` text NOT NULL,
	`start` integer NOT NULL,
	`end` integer,
	`source` text NOT NULL,
	`edited_by` integer,
	`edited_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`edited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `time_records_employee_date` ON `time_records` (`employee_id`,`date`);--> statement-breakpoint
ALTER TABLE `employees` ADD `pin_hash` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `pin_failed` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `employees` ADD `pin_locked_until` text;