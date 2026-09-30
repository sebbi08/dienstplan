CREATE TABLE `absence_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`color` text NOT NULL,
	`credit_mode` text NOT NULL,
	`requires_times` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `absence_codes_key_unique` ON `absence_codes` (`key`);--> statement-breakpoint
CREATE TABLE `balance_adjustments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`date` text NOT NULL,
	`minutes` integer NOT NULL,
	`reason` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `change_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`employee_id` integer,
	`field` text NOT NULL,
	`before` text NOT NULL,
	`after` text NOT NULL,
	`changed_at` text NOT NULL,
	`changed_by` integer,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `change_log_date` ON `change_log` (`date`);--> statement-breakpoint
CREATE TABLE `closures` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`label` text NOT NULL,
	`mode` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `coverage_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`start` integer NOT NULL,
	`end` integer,
	`min_count` integer DEFAULT 1 NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `day_notes` (
	`date` text PRIMARY KEY NOT NULL,
	`info1` text DEFAULT '' NOT NULL,
	`info2` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `employee_hours` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`weekly_minutes` integer NOT NULL,
	`valid_from` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employee_hours_employee_valid_from` ON `employee_hours` (`employee_id`,`valid_from`);--> statement-breakpoint
CREATE TABLE `employees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`short_name` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`left_on` text
);
--> statement-breakpoint
CREATE TABLE `entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`shift_template_id` integer,
	`absence_code_id` integer,
	`start` integer,
	`end` integer,
	`break_start` integer,
	`break_end` integer,
	`counts_as_staff` integer DEFAULT true NOT NULL,
	`note` text,
	`closure_id` integer,
	`updated_at` text NOT NULL,
	`updated_by` integer,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shift_template_id`) REFERENCES `shift_templates`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`absence_code_id`) REFERENCES `absence_codes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closure_id`) REFERENCES `closures`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `entries_date` ON `entries` (`date`);--> statement-breakpoint
CREATE INDEX `entries_employee_date` ON `entries` (`employee_id`,`date`);--> statement-breakpoint
CREATE TABLE `leave_entitlements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`year` integer NOT NULL,
	`days` real NOT NULL,
	`carried_over_days` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leave_entitlements_employee_year` ON `leave_entitlements` (`employee_id`,`year`);--> statement-breakpoint
CREATE TABLE `month_plans` (
	`year` integer NOT NULL,
	`month` integer NOT NULL,
	`released_at` text,
	`released_by` integer,
	PRIMARY KEY(`year`, `month`),
	FOREIGN KEY (`released_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `shift_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`short_label` text DEFAULT '' NOT NULL,
	`label` text NOT NULL,
	`start` integer NOT NULL,
	`end` integer NOT NULL,
	`break_start` integer,
	`break_end` integer,
	`counts_as_staff` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`employee_id` integer,
	`must_change_password` integer DEFAULT false NOT NULL,
	`failed_logins` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_employee_id_unique` ON `users` (`employee_id`);