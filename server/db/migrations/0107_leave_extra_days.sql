CREATE TABLE `leave_extra_days` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`year` integer NOT NULL,
	`days` real NOT NULL,
	`reason` text NOT NULL,
	`created_by` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `leave_extra_days_employee_year` ON `leave_extra_days` (`employee_id`,`year`);