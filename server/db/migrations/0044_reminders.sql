CREATE TABLE `child_development_docs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`child_id` integer NOT NULL,
	`done_on` text NOT NULL,
	`done_by_user_id` integer,
	`done_by_employee_id` integer,
	`done_by_name` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`done_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`done_by_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `child_development_docs_child` ON `child_development_docs` (`child_id`);--> statement-breakpoint
ALTER TABLE `employees` ADD `birthday` text;--> statement-breakpoint
ALTER TABLE `facilities` ADD `doc_mode` text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `doc_interval_months` integer DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `doc_lead_weeks` integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `birthday_lead_days` integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `staff_birthday_lead_days` integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `leaving_lead_weeks` integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE `groups` ADD `doc_mode` text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE `groups` ADD `doc_interval_months` integer DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE `groups` ADD `doc_lead_weeks` integer DEFAULT 2 NOT NULL;