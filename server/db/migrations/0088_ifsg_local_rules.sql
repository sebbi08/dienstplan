CREATE TABLE `ifsg_cluster_acks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`disease` text NOT NULL,
	`up_to` text NOT NULL,
	`acknowledged_on` text NOT NULL,
	`acknowledged_by_name` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ifsg_cluster_acks_facility` ON `ifsg_cluster_acks` (`facility_id`,`disease`);--> statement-breakpoint
CREATE TABLE `ifsg_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`data` blob NOT NULL,
	`uploaded_by` integer,
	`uploaded_at` text NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ifsg_documents_facility` ON `ifsg_documents` (`facility_id`);--> statement-breakpoint
CREATE TABLE `ifsg_local_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`disease` text NOT NULL,
	`custom` integer DEFAULT false NOT NULL,
	`name` text,
	`notifiable` integer,
	`text` text,
	`rules` text,
	`proof` text,
	`notify` integer,
	`household_text` text,
	`household_exclusion` integer,
	`note` text,
	`hint` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ifsg_local_rules_disease` ON `ifsg_local_rules` (`facility_id`,`disease`);--> statement-breakpoint
ALTER TABLE `facilities` ADD `health_office_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `health_office_phone` text DEFAULT '' NOT NULL;