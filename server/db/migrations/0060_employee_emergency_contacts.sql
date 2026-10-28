CREATE TABLE `employee_emergency_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`relation` text DEFAULT '' NOT NULL,
	`phone` text NOT NULL,
	`phone2` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `employee_emergency_contacts_employee` ON `employee_emergency_contacts` (`employee_id`);