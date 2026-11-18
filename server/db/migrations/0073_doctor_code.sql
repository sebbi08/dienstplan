UPDATE `absence_codes` SET `sort_order` = `sort_order` + 1 WHERE `sort_order` >= 7 AND NOT EXISTS (SELECT 1 FROM `absence_codes` WHERE `key` = 'doctor');--> statement-breakpoint
INSERT INTO `absence_codes` (`key`, `label`, `color`, `credit_mode`, `requires_times`, `sort_order`)
SELECT 'doctor', 'Arzt', 'red', 'timed', 1, 7
WHERE EXISTS (SELECT 1 FROM `absence_codes`) AND NOT EXISTS (SELECT 1 FROM `absence_codes` WHERE `key` = 'doctor');
