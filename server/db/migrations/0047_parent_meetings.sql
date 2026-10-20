CREATE TABLE `child_parent_meetings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`child_id` integer NOT NULL,
	`date` text NOT NULL,
	`start` integer NOT NULL,
	`end` integer,
	`kind` text NOT NULL,
	`participants` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`created_by_user_id` integer,
	`created_by_employee_id` integer,
	`created_by_name` text DEFAULT '' NOT NULL,
	`updated_at` text,
	`updated_by_name` text,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `child_parent_meetings_child` ON `child_parent_meetings` (`child_id`);