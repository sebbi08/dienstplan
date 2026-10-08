CREATE TABLE `help_outs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`facility_id` integer NOT NULL,
	`year` integer NOT NULL,
	`month` integer NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `help_outs_employee_facility_month` ON `help_outs` (`employee_id`,`facility_id`,`year`,`month`);--> statement-breakpoint
ALTER TABLE `entries` ADD `help_facility_id` integer REFERENCES facilities(id);