CREATE TABLE `contact_target_groups` (
	`contact_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	PRIMARY KEY(`contact_id`, `group_id`),
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contact_target_groups_group` ON `contact_target_groups` (`group_id`);--> statement-breakpoint
CREATE TABLE `contact_targets` (
	`contact_id` integer NOT NULL,
	`facility_id` integer NOT NULL,
	`all_groups` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`contact_id`, `facility_id`),
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contact_targets_facility` ON `contact_targets` (`facility_id`);--> statement-breakpoint
ALTER TABLE `contacts` ADD `all_facilities` integer DEFAULT false NOT NULL;--> statement-breakpoint
INSERT INTO `contact_targets`("contact_id", "facility_id", "all_groups")
SELECT "id", "facility_id", 1 FROM `contacts` WHERE "facility_id" IS NOT NULL;--> statement-breakpoint
UPDATE `contacts` SET "all_facilities" = 1 WHERE "facility_id" IS NULL;