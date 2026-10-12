CREATE TABLE `employee_requirements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`type_id` integer NOT NULL,
	`date` text NOT NULL,
	`note` text,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`type_id`) REFERENCES `requirement_types`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `employee_requirements_employee` ON `employee_requirements` (`employee_id`);--> statement-breakpoint
CREATE INDEX `employee_requirements_type` ON `employee_requirements` (`type_id`);--> statement-breakpoint
CREATE TABLE `employee_trainings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`date` text NOT NULL,
	`title` text NOT NULL,
	`note` text,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `employee_trainings_employee` ON `employee_trainings` (`employee_id`);--> statement-breakpoint
CREATE TABLE `requirement_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`name` text NOT NULL,
	`interval_months` integer,
	`builtin_key` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `requirement_types_facility_builtin` ON `requirement_types` (`facility_id`,`builtin_key`);--> statement-breakpoint
INSERT INTO `requirement_types` (`facility_id`, `name`, `interval_months`, `builtin_key`, `sort_order`) SELECT `id`, 'Betriebsarzt', 24, 'company_doctor', 0 FROM `facilities`;--> statement-breakpoint
INSERT INTO `requirement_types` (`facility_id`, `name`, `interval_months`, `builtin_key`, `sort_order`) SELECT `id`, 'Erste-Hilfe-Kurs', 24, 'first_aid', 1 FROM `facilities`;--> statement-breakpoint
INSERT INTO `requirement_types` (`facility_id`, `name`, `interval_months`, `builtin_key`, `sort_order`) SELECT `id`, 'Erweitertes Führungszeugnis', 60, 'criminal_record', 2 FROM `facilities`;--> statement-breakpoint
INSERT INTO `requirement_types` (`facility_id`, `name`, `interval_months`, `builtin_key`, `sort_order`) SELECT `id`, 'Masernimpfung (Nachweis)', NULL, 'measles', 3 FROM `facilities`;