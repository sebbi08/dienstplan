CREATE TABLE `group_book_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`field` text NOT NULL,
	`date` text NOT NULL,
	`before` text NOT NULL,
	`after` text NOT NULL,
	`changed_at` text NOT NULL,
	`changed_by_user_id` integer,
	`changed_by_employee_id` integer,
	`changed_by_name` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`changed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`changed_by_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `group_book_changes_group_date` ON `group_book_changes` (`group_id`,`date`);--> statement-breakpoint
CREATE TABLE `group_day_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`date` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by_name` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_day_notes_group_date` ON `group_day_notes` (`group_id`,`date`);--> statement-breakpoint
CREATE TABLE `group_read_access` (
	`group_id` integer NOT NULL,
	`readable_group_id` integer NOT NULL,
	PRIMARY KEY(`group_id`, `readable_group_id`),
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`readable_group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `group_week_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`week_start` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by_name` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_week_notes_group_week` ON `group_week_notes` (`group_id`,`week_start`);