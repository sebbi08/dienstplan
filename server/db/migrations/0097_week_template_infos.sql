CREATE TABLE `week_template_infos` (
	`week_template_id` integer NOT NULL,
	`weekday` integer NOT NULL,
	`info1` text DEFAULT '' NOT NULL,
	`info2` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`week_template_id`, `weekday`),
	FOREIGN KEY (`week_template_id`) REFERENCES `week_templates`(`id`) ON UPDATE no action ON DELETE cascade
);
