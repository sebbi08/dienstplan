CREATE TABLE `leave_forfeit_receipts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`year` integer NOT NULL,
	`days` real NOT NULL,
	`text` text NOT NULL,
	`read_at` text NOT NULL,
	`read_by` integer,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`read_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leave_forfeit_receipts_employee_year` ON `leave_forfeit_receipts` (`employee_id`,`year`);--> statement-breakpoint
ALTER TABLE `facilities` ADD `leave_forfeit_day` integer DEFAULT 31 NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `leave_forfeit_month` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `leave_forfeit_text` text;