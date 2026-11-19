CREATE TABLE `week_template_uses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer DEFAULT 1 NOT NULL,
	`week_start` text NOT NULL,
	`template_id` integer,
	`template_name` text NOT NULL,
	`applied_at` text NOT NULL,
	`applied_by` text NOT NULL,
	`week_fingerprint` text NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `week_templates`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `week_template_uses_facility_week` ON `week_template_uses` (`facility_id`,`week_start`);