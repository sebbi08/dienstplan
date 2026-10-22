CREATE TABLE `staffing_overrides` (
	`facility_id` integer PRIMARY KEY NOT NULL,
	`overrides` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` integer,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `care_types` ADD `days_per_week` integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE `employees` ADD `qualification` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `staffing_share` integer;--> statement-breakpoint
ALTER TABLE `groups` ADD `group_type` text;