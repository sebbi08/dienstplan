-- Appointments in the year calendar and in the plan: an optional last day (`end_date`, several days) and „Wer sieht den
-- Termin?“ (`visibility`: all / groups / employees / leaders, shared/domain/calendarEvents.ts) with the chosen groups
-- and employees in two lists. The former „Auch für Mitarbeitende sichtbar?“ becomes 'all' (ja) or 'leaders' (nein), so
-- nobody sees more than before; the old column is dropped afterwards.
-- A list that loses its last group or employee (the group or the employee is deleted, ON DELETE CASCADE) turns its
-- appointment into 'leaders' (the triggers below): it never shows to more people than chosen.
CREATE TABLE `calendar_event_employees` (
	`event_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	PRIMARY KEY(`event_id`, `employee_id`),
	FOREIGN KEY (`event_id`) REFERENCES `calendar_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `calendar_event_employees_employee` ON `calendar_event_employees` (`employee_id`);--> statement-breakpoint
CREATE TABLE `calendar_event_groups` (
	`event_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	PRIMARY KEY(`event_id`, `group_id`),
	FOREIGN KEY (`event_id`) REFERENCES `calendar_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `calendar_event_groups_group` ON `calendar_event_groups` (`group_id`);--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `end_date` text;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `visibility` text DEFAULT 'leaders' NOT NULL;--> statement-breakpoint
UPDATE `calendar_events` SET `visibility` = CASE WHEN `visible_to_staff` = 1 THEN 'all' ELSE 'leaders' END;--> statement-breakpoint
ALTER TABLE `calendar_events` DROP COLUMN `visible_to_staff`;--> statement-breakpoint
CREATE TRIGGER `calendar_event_groups_emptied` AFTER DELETE ON `calendar_event_groups`
WHEN NOT EXISTS (SELECT 1 FROM `calendar_event_groups` WHERE `event_id` = OLD.`event_id`)
BEGIN
	UPDATE `calendar_events` SET `visibility` = 'leaders' WHERE `id` = OLD.`event_id` AND `visibility` = 'groups';
END;--> statement-breakpoint
CREATE TRIGGER `calendar_event_employees_emptied` AFTER DELETE ON `calendar_event_employees`
WHEN NOT EXISTS (SELECT 1 FROM `calendar_event_employees` WHERE `event_id` = OLD.`event_id`)
BEGIN
	UPDATE `calendar_events` SET `visibility` = 'leaders' WHERE `id` = OLD.`event_id` AND `visibility` = 'employees';
END;
