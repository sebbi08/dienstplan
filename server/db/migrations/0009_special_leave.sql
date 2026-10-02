UPDATE `absence_codes` SET `sort_order` = `sort_order` + 1 WHERE `sort_order` >= 2 AND NOT EXISTS (SELECT 1 FROM `absence_codes` WHERE `key` = 'special_leave');--> statement-breakpoint
INSERT INTO `absence_codes` (`key`, `label`, `color`, `credit_mode`, `requires_times`, `sort_order`)
SELECT 'special_leave', 'Sonderurlaub', 'gray', 'daily_target', 0, 2
WHERE EXISTS (SELECT 1 FROM `absence_codes`) AND NOT EXISTS (SELECT 1 FROM `absence_codes` WHERE `key` = 'special_leave');
