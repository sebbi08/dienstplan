CREATE TABLE `groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `groups_facility` ON `groups` (`facility_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_week_template_marks` (
	`facility_id` integer DEFAULT 1 NOT NULL,
	`week_start` text NOT NULL,
	`week_template_id` integer NOT NULL,
	`group_id` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`facility_id`, `group_id`, `week_start`),
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`week_template_id`) REFERENCES `week_templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_week_template_marks`("facility_id", "week_start", "week_template_id", "group_id") SELECT "facility_id", "week_start", "week_template_id", 0 FROM `week_template_marks`;--> statement-breakpoint
DROP TABLE `week_template_marks`;--> statement-breakpoint
ALTER TABLE `__new_week_template_marks` RENAME TO `week_template_marks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `coverage_rules` ADD `group_id` integer REFERENCES groups(id);--> statement-breakpoint
ALTER TABLE `employees` ADD `group_id` integer REFERENCES groups(id);--> statement-breakpoint
ALTER TABLE `entries` ADD `group_id` integer REFERENCES groups(id);--> statement-breakpoint
ALTER TABLE `week_templates` ADD `group_id` integer REFERENCES groups(id);