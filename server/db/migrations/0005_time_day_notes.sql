CREATE TABLE `time_day_notes` (
	`employee_id` integer NOT NULL,
	`date` text NOT NULL,
	`note` text NOT NULL,
	PRIMARY KEY(`employee_id`, `date`),
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
