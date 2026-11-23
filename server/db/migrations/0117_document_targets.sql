CREATE TABLE `knowledge_entry_target_groups` (
	`entry_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	PRIMARY KEY(`entry_id`, `group_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `knowledge_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `knowledge_entry_target_groups_group` ON `knowledge_entry_target_groups` (`group_id`);--> statement-breakpoint
CREATE TABLE `knowledge_entry_targets` (
	`entry_id` integer NOT NULL,
	`facility_id` integer NOT NULL,
	`all_groups` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`entry_id`, `facility_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `knowledge_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `knowledge_entry_targets_facility` ON `knowledge_entry_targets` (`facility_id`);--> statement-breakpoint
CREATE TABLE `print_template_target_groups` (
	`template_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	PRIMARY KEY(`template_id`, `group_id`),
	FOREIGN KEY (`template_id`) REFERENCES `print_templates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `print_template_target_groups_group` ON `print_template_target_groups` (`group_id`);--> statement-breakpoint
CREATE TABLE `print_template_targets` (
	`template_id` integer NOT NULL,
	`facility_id` integer NOT NULL,
	`all_groups` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`template_id`, `facility_id`),
	FOREIGN KEY (`template_id`) REFERENCES `print_templates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `print_template_targets_facility` ON `print_template_targets` (`facility_id`);--> statement-breakpoint
ALTER TABLE `knowledge_entries` ADD `all_facilities` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `print_templates` ADD `all_facilities` integer DEFAULT false NOT NULL;--> statement-breakpoint
INSERT INTO `print_template_targets`("template_id", "facility_id", "all_groups")
SELECT "id", "facility_id", 1 FROM `print_templates` WHERE "facility_id" IS NOT NULL;--> statement-breakpoint
UPDATE `print_templates` SET "all_facilities" = 1 WHERE "facility_id" IS NULL;--> statement-breakpoint
INSERT INTO `knowledge_entry_targets`("entry_id", "facility_id", "all_groups")
SELECT "id", "facility_id", 1 FROM `knowledge_entries` WHERE "facility_id" IS NOT NULL;--> statement-breakpoint
UPDATE `knowledge_entries` SET "all_facilities" = 1 WHERE "facility_id" IS NULL;