CREATE TABLE `week_template_marks` (
	`week_start` text PRIMARY KEY NOT NULL,
	`week_template_id` integer NOT NULL,
	FOREIGN KEY (`week_template_id`) REFERENCES `week_templates`(`id`) ON UPDATE no action ON DELETE cascade
);
