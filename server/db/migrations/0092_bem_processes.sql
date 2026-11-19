CREATE TABLE `bem_processes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`status` text DEFAULT 'invited' NOT NULL,
	`invited_on` text,
	`answered_on` text,
	`completed_on` text,
	`created_by` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bem_processes_employee` ON `bem_processes` (`employee_id`);--> statement-breakpoint
CREATE TABLE `bem_steps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`process_id` integer NOT NULL,
	`kind` text NOT NULL,
	`date` text NOT NULL,
	`participants` text DEFAULT '' NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`status` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`process_id`) REFERENCES `bem_processes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bem_steps_process` ON `bem_steps` (`process_id`);--> statement-breakpoint
ALTER TABLE `facilities` ADD `bem_invitation_text` text;--> statement-breakpoint
ALTER TABLE `retention_settings` ADD `bem_years` integer DEFAULT 3 NOT NULL;