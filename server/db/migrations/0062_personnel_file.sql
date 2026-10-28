CREATE TABLE `employee_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`folder` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`document_date` text,
	`note` text DEFAULT '' NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`data` blob NOT NULL,
	`uploaded_by` integer,
	`uploaded_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `employee_documents_employee` ON `employee_documents` (`employee_id`);--> statement-breakpoint
CREATE TABLE `employee_payroll` (
	`employee_id` integer PRIMARY KEY NOT NULL,
	`tax_id` text,
	`tax_class` integer,
	`sv_number` text,
	`health_insurer` text,
	`iban` text,
	`account_holder` text,
	`denomination` text,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `employees` ADD `birth_year` integer;--> statement-breakpoint
ALTER TABLE `employees` ADD `street` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `postal_code` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `city` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `phone` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `email` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `nationality` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `disability` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `employees` ADD `disability_degree` integer;--> statement-breakpoint
ALTER TABLE `employees` ADD `disability_equal` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `employees` ADD `disability_until` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `fixed_term_until` text;