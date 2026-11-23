CREATE TABLE `school_district_lists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer,
	`name` text DEFAULT '' NOT NULL,
	`as_of` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` integer,
	`updated_at` text NOT NULL,
	`updated_by` integer,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `school_district_lists_scope` ON `school_district_lists` ((case when "facility_id" is null then 0 else "facility_id" end));--> statement-breakpoint
CREATE TABLE `school_district_rows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`list_id` integer NOT NULL,
	`street` text NOT NULL,
	`street_key` text NOT NULL,
	`from_no` integer,
	`from_suffix` text DEFAULT '' NOT NULL,
	`to_no` integer,
	`to_suffix` text DEFAULT '' NOT NULL,
	`side` text DEFAULT 'all' NOT NULL,
	`district` text NOT NULL,
	`flags` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `school_district_lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `school_district_rows_list_street` ON `school_district_rows` (`list_id`,`street_key`);--> statement-breakpoint
CREATE TABLE `school_districts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`list_id` integer NOT NULL,
	`code` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`contact_id` integer,
	FOREIGN KEY (`list_id`) REFERENCES `school_district_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `school_districts_list_code` ON `school_districts` (`list_id`,`code`);--> statement-breakpoint
CREATE INDEX `school_districts_contact` ON `school_districts` (`contact_id`);