CREATE TABLE `group_merges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`date` text NOT NULL,
	`group_ids` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by_name` text NOT NULL,
	`ended_at` text,
	`ended_by_name` text,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `group_merges_facility_date` ON `group_merges` (`facility_id`,`date`);