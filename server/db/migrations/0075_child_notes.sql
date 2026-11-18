CREATE TABLE `child_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`child_id` integer NOT NULL,
	`date` text NOT NULL,
	`text` text NOT NULL,
	`educator_employee_id` integer,
	`educator_name` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`created_by_user_id` integer,
	`created_by_employee_id` integer,
	`created_by_name` text DEFAULT '' NOT NULL,
	`updated_at` text,
	`updated_by_name` text,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`educator_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `child_notes_child` ON `child_notes` (`child_id`);