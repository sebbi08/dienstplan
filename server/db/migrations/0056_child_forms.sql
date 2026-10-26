CREATE TABLE `form_editors` (
	`form_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`granted_at` text NOT NULL,
	`granted_by` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`form_id`, `employee_id`),
	FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `form_starter_seeds` (
	`facility_id` integer NOT NULL,
	`starter_key` text NOT NULL,
	`seeded_at` text NOT NULL,
	PRIMARY KEY(`facility_id`, `starter_key`),
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `forms` ADD `child_id` integer REFERENCES children(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `forms` ADD `parent_meeting_id` integer REFERENCES child_parent_meetings(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `forms` ADD `form_date` text;--> statement-breakpoint
ALTER TABLE `forms` ADD `form_start` integer;--> statement-breakpoint
ALTER TABLE `forms` ADD `form_participants` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `forms_child` ON `forms` (`child_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `forms_parent_meeting` ON `forms` (`parent_meeting_id`) WHERE parent_meeting_id IS NOT NULL;--> statement-breakpoint
INSERT INTO `form_starter_seeds` (`facility_id`, `starter_key`, `seeded_at`)
	SELECT `id`, 'staff_self_assessment', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM `facilities` WHERE `form_starters_seeded` = 1;--> statement-breakpoint
INSERT INTO `form_starter_seeds` (`facility_id`, `starter_key`, `seeded_at`)
	SELECT `id`, 'staff_assessment', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM `facilities` WHERE `form_starters_seeded` = 1;