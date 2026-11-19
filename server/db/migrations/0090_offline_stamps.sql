CREATE TABLE `offline_stamps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` text NOT NULL,
	`facility_id` integer DEFAULT 1 NOT NULL,
	`employee_id` integer,
	`action` text NOT NULL,
	`stamped_at` text NOT NULL,
	`date` text NOT NULL,
	`minutes` integer NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`record_id` integer,
	`clock_skew_minutes` integer,
	`received_at` text NOT NULL,
	`checked_at` text,
	`checked_by` integer,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`record_id`) REFERENCES `time_records`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`checked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `offline_stamps_client_id_unique` ON `offline_stamps` (`client_id`);--> statement-breakpoint
CREATE INDEX `offline_stamps_employee` ON `offline_stamps` (`employee_id`);--> statement-breakpoint
ALTER TABLE `time_records` ADD `offline` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `time_records` ADD `clock_skew_minutes` integer;