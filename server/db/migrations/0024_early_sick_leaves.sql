CREATE TABLE `early_sick_leaves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`date` text NOT NULL,
	`left_at` integer,
	`note` text,
	`created_at` text NOT NULL,
	`created_by` integer,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `early_sick_leaves_employee_date` ON `early_sick_leaves` (`employee_id`,`date`);