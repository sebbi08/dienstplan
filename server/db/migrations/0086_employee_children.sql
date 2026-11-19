CREATE TABLE `employee_children` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`first_name` text,
	`birth_date` text NOT NULL,
	`disabled_dependent` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `employee_children_employee` ON `employee_children` (`employee_id`);--> statement-breakpoint
ALTER TABLE `employees` ADD `single_parent` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `entries` ADD `employee_child_id` integer REFERENCES employee_children(id) ON DELETE SET NULL;--> statement-breakpoint
UPDATE `absence_codes` SET `sort_order` = `sort_order` + 1 WHERE `sort_order` >= 5 AND NOT EXISTS (SELECT 1 FROM `absence_codes` WHERE `key` = 'child_sick');--> statement-breakpoint
INSERT INTO `absence_codes` (`key`, `label`, `color`, `credit_mode`, `requires_times`, `sort_order`)
SELECT 'child_sick', 'Kind krank', 'gray', 'daily_target', 0, 5
WHERE EXISTS (SELECT 1 FROM `absence_codes`) AND NOT EXISTS (SELECT 1 FROM `absence_codes` WHERE `key` = 'child_sick');
