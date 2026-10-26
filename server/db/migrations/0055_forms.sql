CREATE TABLE `form_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`starter_key` text,
	`self_assessment` integer DEFAULT false NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `form_templates_facility_kind` ON `form_templates` (`facility_id`,`kind`);--> statement-breakpoint
CREATE TABLE `forms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`template_id` integer,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`answers` text DEFAULT '{}' NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`read_released` integer DEFAULT false NOT NULL,
	`released_at` text,
	`submitted_at` text,
	`read_released_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `form_templates`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `forms_facility` ON `forms` (`facility_id`);--> statement-breakpoint
CREATE INDEX `forms_template` ON `forms` (`template_id`);--> statement-breakpoint
CREATE TABLE `staff_talk_forms` (
	`talk_id` integer NOT NULL,
	`form_id` integer NOT NULL,
	`role` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`talk_id`, `form_id`),
	FOREIGN KEY (`talk_id`) REFERENCES `staff_talks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_talk_forms_form` ON `staff_talk_forms` (`form_id`);--> statement-breakpoint
CREATE TABLE `staff_talks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`date` text NOT NULL,
	`start` integer,
	`participants` text DEFAULT '' NOT NULL,
	`period` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` integer,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `staff_talks_facility_employee` ON `staff_talks` (`facility_id`,`employee_id`);--> statement-breakpoint
ALTER TABLE `facilities` ADD `form_starters_seeded` integer DEFAULT false NOT NULL;