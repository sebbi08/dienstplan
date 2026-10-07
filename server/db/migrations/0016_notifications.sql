CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`year` integer NOT NULL,
	`month` integer NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text,
	`changes` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_employee` ON `notifications` (`employee_id`);