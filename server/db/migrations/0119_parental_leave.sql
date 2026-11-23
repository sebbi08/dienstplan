CREATE TABLE `parental_leaves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`child_id` integer,
	`child_birth_date` text NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`part_time_weekly_minutes` integer,
	`reduce_leave` integer DEFAULT false NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`child_id`) REFERENCES `employee_children`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `parental_leaves_employee` ON `parental_leaves` (`employee_id`);--> statement-breakpoint
ALTER TABLE `facilities` ADD `parental_leave_visible` integer DEFAULT false NOT NULL;