CREATE TABLE `retention_settings` (
	`facility_id` integer PRIMARY KEY NOT NULL,
	`time_years` integer DEFAULT 2 NOT NULL,
	`assessment_years` integer DEFAULT 3 NOT NULL,
	`paid_overtime_years` integer DEFAULT 10 NOT NULL,
	`pension_years` integer DEFAULT 30 NOT NULL,
	`cash_years` integer DEFAULT 10 NOT NULL,
	`employee_delete` text DEFAULT 'managers' NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `balance_adjustments` ADD `paid_out` integer DEFAULT false NOT NULL;