CREATE TABLE `cash_boxes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`group_id` integer,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`start_year` integer NOT NULL,
	`start_month` integer NOT NULL,
	`start_balance` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cash_boxes_facility` ON `cash_boxes` (`facility_id`);--> statement-breakpoint
CREATE TABLE `cash_closed_months` (
	`box_id` integer NOT NULL,
	`year` integer NOT NULL,
	`month` integer NOT NULL,
	`closed_at` text NOT NULL,
	`closed_by` text NOT NULL,
	PRIMARY KEY(`box_id`, `year`, `month`),
	FOREIGN KEY (`box_id`) REFERENCES `cash_boxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `cash_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`box_id` integer NOT NULL,
	`date` text NOT NULL,
	`direction` text NOT NULL,
	`cents` integer NOT NULL,
	`purpose` text NOT NULL,
	`receipt_id` integer,
	`transfer_id` integer,
	`transfer_text` text,
	`created_at` text NOT NULL,
	`created_by` integer,
	FOREIGN KEY (`box_id`) REFERENCES `cash_boxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`receipt_id`) REFERENCES `cash_receipts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `cash_entries_box_date` ON `cash_entries` (`box_id`,`date`);--> statement-breakpoint
CREATE INDEX `cash_entries_transfer` ON `cash_entries` (`transfer_id`);--> statement-breakpoint
CREATE TABLE `cash_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`box_id` integer NOT NULL,
	`at` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`detail` text NOT NULL,
	`month` text,
	FOREIGN KEY (`box_id`) REFERENCES `cash_boxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cash_log_box_month` ON `cash_log` (`box_id`,`month`);--> statement-breakpoint
CREATE TABLE `cash_receipts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`mime` text NOT NULL,
	`data` blob NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cash_receipts_facility` ON `cash_receipts` (`facility_id`);