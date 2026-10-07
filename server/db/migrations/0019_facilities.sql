CREATE TABLE `facilities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`time_tracking_from` text,
	`leave_max_concurrent` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `facilities_name_unique` ON `facilities` (`name`);--> statement-breakpoint
-- The existing data becomes facility 1. Inserted first, so every facility_id = 1 below resolves right away.
INSERT INTO `facilities` (`id`, `name`, `sort_order`, `time_tracking_from`, `leave_max_concurrent`) VALUES (
	1, 'Kindergarten', 0,
	(SELECT `value` FROM `app_settings` WHERE `key` = 'time_tracking_from'),
	(SELECT CAST(`value` AS integer) FROM `app_settings` WHERE `key` = 'leave_max_concurrent')
);--> statement-breakpoint
DROP INDEX `early_closures_date_unique`;--> statement-breakpoint
ALTER TABLE `early_closures` ADD `facility_id` integer DEFAULT 1 NOT NULL REFERENCES facilities(id);--> statement-breakpoint
CREATE UNIQUE INDEX `early_closures_facility_date` ON `early_closures` (`facility_id`,`date`);--> statement-breakpoint
DROP INDEX `week_templates_name_unique`;--> statement-breakpoint
ALTER TABLE `week_templates` ADD `facility_id` integer DEFAULT 1 NOT NULL REFERENCES facilities(id);--> statement-breakpoint
CREATE UNIQUE INDEX `week_templates_facility_name` ON `week_templates` (`facility_id`,`name`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_month_plans` (
	`facility_id` integer DEFAULT 1 NOT NULL,
	`year` integer NOT NULL,
	`month` integer NOT NULL,
	`released_at` text,
	`released_by` integer,
	PRIMARY KEY(`facility_id`, `year`, `month`),
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`released_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_month_plans`("facility_id", "year", "month", "released_at", "released_by") SELECT 1, "year", "month", "released_at", "released_by" FROM `month_plans`;--> statement-breakpoint
DROP TABLE `month_plans`;--> statement-breakpoint
ALTER TABLE `__new_month_plans` RENAME TO `month_plans`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_day_notes` (
	`facility_id` integer DEFAULT 1 NOT NULL,
	`date` text NOT NULL,
	`info1` text DEFAULT '' NOT NULL,
	`info2` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`facility_id`, `date`),
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_day_notes`("facility_id", "date", "info1", "info2") SELECT 1, "date", "info1", "info2" FROM `day_notes`;--> statement-breakpoint
DROP TABLE `day_notes`;--> statement-breakpoint
ALTER TABLE `__new_day_notes` RENAME TO `day_notes`;--> statement-breakpoint
CREATE TABLE `__new_week_template_marks` (
	`facility_id` integer DEFAULT 1 NOT NULL,
	`week_start` text NOT NULL,
	`week_template_id` integer NOT NULL,
	PRIMARY KEY(`facility_id`, `week_start`),
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`week_template_id`) REFERENCES `week_templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_week_template_marks`("facility_id", "week_start", "week_template_id") SELECT 1, "week_start", "week_template_id" FROM `week_template_marks`;--> statement-breakpoint
DROP TABLE `week_template_marks`;--> statement-breakpoint
ALTER TABLE `__new_week_template_marks` RENAME TO `week_template_marks`;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `facility_id` integer DEFAULT 1 NOT NULL REFERENCES facilities(id);--> statement-breakpoint
ALTER TABLE `change_log` ADD `facility_id` integer DEFAULT 1 NOT NULL REFERENCES facilities(id);--> statement-breakpoint
CREATE INDEX `change_log_facility_date` ON `change_log` (`facility_id`,`date`);--> statement-breakpoint
ALTER TABLE `closures` ADD `facility_id` integer DEFAULT 1 NOT NULL REFERENCES facilities(id);--> statement-breakpoint
ALTER TABLE `coverage_rules` ADD `facility_id` integer DEFAULT 1 NOT NULL REFERENCES facilities(id);--> statement-breakpoint
ALTER TABLE `employees` ADD `facility_id` integer DEFAULT 1 NOT NULL REFERENCES facilities(id);--> statement-breakpoint
ALTER TABLE `release_snapshots` ADD `facility_id` integer DEFAULT 1 NOT NULL REFERENCES facilities(id);--> statement-breakpoint
CREATE INDEX `release_snapshots_facility_month` ON `release_snapshots` (`facility_id`,`year`,`month`);--> statement-breakpoint
ALTER TABLE `shift_templates` ADD `facility_id` integer DEFAULT 1 NOT NULL REFERENCES facilities(id);--> statement-breakpoint
ALTER TABLE `users` ADD `facility_id` integer REFERENCES facilities(id);--> statement-breakpoint
DELETE FROM `app_settings` WHERE `key` IN ('time_tracking_from', 'leave_max_concurrent');--> statement-breakpoint
UPDATE `users` SET `facility_id` = 1 WHERE `role` IN ('admin', 'terminal', 'provider');