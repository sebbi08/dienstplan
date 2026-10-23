CREATE TABLE `warning_acks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`key` text NOT NULL,
	`date` text NOT NULL,
	`signature` text NOT NULL,
	`acknowledged_at` text NOT NULL,
	`acknowledged_by` integer,
	`acknowledged_by_name` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`acknowledged_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `warning_acks_facility_key` ON `warning_acks` (`facility_id`,`key`);--> statement-breakpoint
CREATE INDEX `warning_acks_facility_date` ON `warning_acks` (`facility_id`,`date`);