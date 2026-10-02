CREATE TABLE `week_template_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`week_template_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`weekday` integer NOT NULL,
	`kind` text NOT NULL,
	`shift_template_id` integer,
	`absence_code_id` integer,
	`start` integer,
	`end` integer,
	`break_start` integer,
	`break_end` integer,
	`counts_as_staff` integer DEFAULT true NOT NULL,
	`note` text,
	FOREIGN KEY (`week_template_id`) REFERENCES `week_templates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shift_template_id`) REFERENCES `shift_templates`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`absence_code_id`) REFERENCES `absence_codes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `week_template_entries_template` ON `week_template_entries` (`week_template_id`);--> statement-breakpoint
CREATE TABLE `week_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `week_templates_name_unique` ON `week_templates` (`name`);