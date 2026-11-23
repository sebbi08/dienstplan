CREATE TABLE `knowledge_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`visibility` text DEFAULT 'all' NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_categories_facility_name` ON `knowledge_categories` (`facility_id`,lower("name"));--> statement-breakpoint
CREATE TABLE `knowledge_confirmations` (
	`entry_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`entry_version` integer NOT NULL,
	`confirmed_at` text NOT NULL,
	`via` text NOT NULL,
	PRIMARY KEY(`entry_id`, `employee_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `knowledge_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `knowledge_confirmations_employee` ON `knowledge_confirmations` (`employee_id`);--> statement-breakpoint
CREATE TABLE `knowledge_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer,
	`category_id` integer,
	`category_name` text,
	`visibility` text DEFAULT 'all' NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`as_of` text,
	`file_data` blob,
	`file_mime` text,
	`file_size` integer,
	`url` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`needs_confirmation` integer DEFAULT false NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`starter_key` text,
	`created_at` text NOT NULL,
	`created_by` integer,
	`updated_at` text NOT NULL,
	`updated_by` integer,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `knowledge_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `knowledge_entries_facility` ON `knowledge_entries` (`facility_id`);--> statement-breakpoint
CREATE INDEX `knowledge_entries_category` ON `knowledge_entries` (`category_id`);--> statement-breakpoint
CREATE TABLE `knowledge_starter_seeds` (
	`facility_id` integer NOT NULL,
	`starter_key` text NOT NULL,
	`seeded_at` text NOT NULL,
	PRIMARY KEY(`facility_id`, `starter_key`),
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade
);
