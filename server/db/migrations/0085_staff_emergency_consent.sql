CREATE TABLE `employee_emergency_consent` (
	`employee_id` integer PRIMARY KEY NOT NULL,
	`consent` integer DEFAULT false NOT NULL,
	`consent_at` text NOT NULL,
	`consent_date` text NOT NULL,
	`consent_by` text NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `employee_emergency_consent_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`granted` integer NOT NULL,
	`source` text NOT NULL,
	`by` text NOT NULL,
	`at` text NOT NULL,
	`date` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `employee_emergency_consent_log_employee` ON `employee_emergency_consent_log` (`employee_id`);