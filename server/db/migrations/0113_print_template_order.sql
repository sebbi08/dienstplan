CREATE TABLE `print_template_order` (
	`facility_id` integer NOT NULL,
	`template_id` integer NOT NULL,
	`sort_order` integer NOT NULL,
	PRIMARY KEY(`facility_id`, `template_id`),
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `print_templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `print_template_order_template` ON `print_template_order` (`template_id`);