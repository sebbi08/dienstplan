CREATE TABLE `form_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`form_id` integer NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`data` blob NOT NULL,
	`uploaded_at` text NOT NULL,
	`uploaded_by_name` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `form_attachments_form` ON `form_attachments` (`form_id`);--> statement-breakpoint
ALTER TABLE `form_templates` ADD `subject` text;--> statement-breakpoint
ALTER TABLE `forms` ADD `employee_id` integer REFERENCES employees(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `forms` ADD `accident_doctor` integer;--> statement-breakpoint
ALTER TABLE `forms` ADD `accident_unfit` integer;--> statement-breakpoint
ALTER TABLE `forms` ADD `accident_reported_on` text;--> statement-breakpoint
ALTER TABLE `forms` ADD `created_by_user_id` integer REFERENCES users(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `forms` ADD `created_by_employee_id` integer REFERENCES employees(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `forms` ADD `print_layout` text;--> statement-breakpoint
CREATE INDEX `forms_employee` ON `forms` (`employee_id`);