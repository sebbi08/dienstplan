-- „Zum Unterschreiben senden“: requests to sign a PDF in the app, their recipients and the tablet's sign-only unlock (server/services/signRequests.ts).
CREATE TABLE `sign_request_recipients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`signed_at` text,
	`declined_at` text,
	`decline_reason` text,
	`withdrawn_at` text,
	`signed_document_id` integer,
	`signed_hash` text,
	`reminded_at` text,
	FOREIGN KEY (`request_id`) REFERENCES `sign_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`signed_document_id`) REFERENCES `employee_documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sign_request_recipients_request_employee` ON `sign_request_recipients` (`request_id`,`employee_id`);--> statement-breakpoint
CREATE INDEX `sign_request_recipients_employee` ON `sign_request_recipients` (`employee_id`,`status`);--> statement-breakpoint
CREATE TABLE `sign_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`created_by` integer,
	`created_at` text NOT NULL,
	`title` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_template_id` integer,
	`source_document_id` integer,
	`file_data` blob,
	`file_size` integer NOT NULL,
	`file_sha256` text NOT NULL,
	`source_folder` text,
	`source_visibility` text,
	`source_employee_id` integer,
	`deleted_at` text,
	`target_folder` text NOT NULL,
	`due_date` text,
	`note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_template_id`) REFERENCES `print_templates`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_document_id`) REFERENCES `employee_documents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `sign_requests_facility` ON `sign_requests` (`facility_id`);--> statement-breakpoint
CREATE INDEX `sign_requests_source_employee` ON `sign_requests` (`source_employee_id`);--> statement-breakpoint
CREATE TABLE `sign_unlocks` (
	`id` text PRIMARY KEY NOT NULL,
	`terminal_user_id` integer NOT NULL,
	`facility_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`created_at` text NOT NULL,
	`last_active_at` text NOT NULL,
	FOREIGN KEY (`terminal_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sign_unlocks_terminal_user_id_unique` ON `sign_unlocks` (`terminal_user_id`);