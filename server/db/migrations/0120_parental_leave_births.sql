CREATE TABLE `parental_leave_births` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`child_birth_date` text NOT NULL,
	`protection_until` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `parental_leave_births_employee_birth` ON `parental_leave_births` (`employee_id`,`child_birth_date`);