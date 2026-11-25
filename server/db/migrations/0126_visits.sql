-- „Infogespräche & Hospitationen“ (server/services/visits.ts): info visits, applicants with their days, their documents, the forms of a
-- visit (kinds info and applicant) and the retention months of both (deleted by hand under Löschfristen).
CREATE TABLE `applicant_visit_days` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`visit_id` integer NOT NULL,
	`date` text NOT NULL,
	`from` integer,
	`to` integer,
	FOREIGN KEY (`visit_id`) REFERENCES `applicant_visits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applicant_visit_days_visit_date` ON `applicant_visit_days` (`visit_id`,`date`);--> statement-breakpoint
CREATE TABLE `applicant_visits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`name` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`declined_at` text,
	`notes` text DEFAULT '' NOT NULL,
	`mentor_employee_id` integer,
	`employee_id` integer,
	`created_at` text NOT NULL,
	`created_by` integer,
	`updated_at` text NOT NULL,
	`updated_by` integer,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mentor_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `applicant_visits_facility` ON `applicant_visits` (`facility_id`);--> statement-breakpoint
CREATE INDEX `applicant_visits_employee` ON `applicant_visits` (`employee_id`);--> statement-breakpoint
CREATE TABLE `info_visits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`visit_date` text NOT NULL,
	`visit_start` integer,
	`family_name` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`child_first_name` text DEFAULT '' NOT NULL,
	`child_last_name` text DEFAULT '' NOT NULL,
	`child_birth_date` text,
	`desired_start` text,
	`guided_by_employee_id` integer,
	`guided_by_name` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`child_id` integer,
	`created_at` text NOT NULL,
	`created_by` integer,
	`updated_at` text NOT NULL,
	`updated_by` integer,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`guided_by_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `info_visits_facility` ON `info_visits` (`facility_id`);--> statement-breakpoint
CREATE INDEX `info_visits_child` ON `info_visits` (`child_id`);--> statement-breakpoint
CREATE TABLE `visit_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`info_visit_id` integer,
	`applicant_visit_id` integer,
	`title` text DEFAULT '' NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`data` blob NOT NULL,
	`fillable` integer,
	`uploaded_by` integer,
	`uploaded_at` text NOT NULL,
	FOREIGN KEY (`info_visit_id`) REFERENCES `info_visits`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`applicant_visit_id`) REFERENCES `applicant_visits`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `visit_documents_info_visit` ON `visit_documents` (`info_visit_id`);--> statement-breakpoint
CREATE INDEX `visit_documents_applicant_visit` ON `visit_documents` (`applicant_visit_id`);--> statement-breakpoint
ALTER TABLE `forms` ADD `info_visit_id` integer REFERENCES info_visits(id) ON UPDATE no action ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `forms` ADD `applicant_visit_id` integer REFERENCES applicant_visits(id) ON UPDATE no action ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `forms_info_visit` ON `forms` (`info_visit_id`);--> statement-breakpoint
CREATE INDEX `forms_applicant_visit` ON `forms` (`applicant_visit_id`);--> statement-breakpoint
ALTER TABLE `retention_settings` ADD `info_visit_months` integer DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE `retention_settings` ADD `applicant_months` integer DEFAULT 6 NOT NULL;