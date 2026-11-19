CREATE TABLE `maternity_cases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`notified_on` text NOT NULL,
	`expected_birth` text NOT NULL,
	`actual_birth` text,
	`extended_after` integer DEFAULT false NOT NULL,
	`breastfeeding_until` text,
	`authority_notified_on` text,
	`risk_assessment_on` text,
	`employment_ban` text DEFAULT 'none' NOT NULL,
	`ban_from` text,
	`ban_to` text,
	`ban_note` text DEFAULT '' NOT NULL,
	`ban_checked_on` text,
	`protection_booked` integer DEFAULT false NOT NULL,
	`ban_booked` integer DEFAULT false NOT NULL,
	`ended_on` text,
	`created_by` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `maternity_cases_employee` ON `maternity_cases` (`employee_id`);--> statement-breakpoint
UPDATE `absence_codes` SET `sort_order` = `sort_order` + 2 WHERE `sort_order` >= 6 AND NOT EXISTS (SELECT 1 FROM `absence_codes` WHERE `key` = 'maternity');--> statement-breakpoint
INSERT INTO `absence_codes` (`key`, `label`, `color`, `credit_mode`, `requires_times`, `sort_order`)
SELECT 'maternity', 'Mutterschutz', 'gray', 'daily_target', 0, 6
WHERE EXISTS (SELECT 1 FROM `absence_codes`) AND NOT EXISTS (SELECT 1 FROM `absence_codes` WHERE `key` = 'maternity');--> statement-breakpoint
INSERT INTO `absence_codes` (`key`, `label`, `color`, `credit_mode`, `requires_times`, `sort_order`)
SELECT 'employment_ban', 'Beschäftigungsverbot', 'gray', 'daily_target', 0, 7
WHERE EXISTS (SELECT 1 FROM `absence_codes`) AND NOT EXISTS (SELECT 1 FROM `absence_codes` WHERE `key` = 'employment_ban');