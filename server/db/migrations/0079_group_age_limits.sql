CREATE TABLE `group_age_limits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`from_years` integer NOT NULL,
	`to_years` integer NOT NULL,
	`max_children` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `group_age_limits_group` ON `group_age_limits` (`group_id`);