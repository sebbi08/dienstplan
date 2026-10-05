ALTER TABLE `employees` ADD `employed_since` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `job_key` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `job_other` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `pay_group` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `pay_level` integer;--> statement-breakpoint
UPDATE `users` SET `role` = 'provider'
WHERE `id` = (SELECT min(`id`) FROM `users` WHERE `role` = 'admin' AND `active` = 1)
AND NOT EXISTS (SELECT 1 FROM `users` WHERE `role` = 'provider');
