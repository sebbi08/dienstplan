ALTER TABLE `employees` ADD `personnel_number` text;--> statement-breakpoint
CREATE UNIQUE INDEX `employees_personnel_number_unique` ON `employees` (`personnel_number`);