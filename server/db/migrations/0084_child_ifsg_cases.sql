CREATE TABLE `child_ifsg_cases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`child_id` integer NOT NULL,
	`facility_id` integer DEFAULT 1 NOT NULL,
	`disease` text NOT NULL,
	`kind` text NOT NULL,
	`reported_on` text NOT NULL,
	`onset_date` text NOT NULL,
	`rule_variant` text,
	`rule_date` text,
	`created_by_user_id` integer,
	`created_by_name` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`readmitted_on` text,
	`readmission_note` text DEFAULT '' NOT NULL,
	`readmitted_by_name` text DEFAULT '' NOT NULL,
	`readmission_attachment_id` integer,
	`health_office_notified_on` text,
	`physician_reported` integer DEFAULT false NOT NULL,
	`ended` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`readmission_attachment_id`) REFERENCES `child_documents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `child_ifsg_cases_child` ON `child_ifsg_cases` (`child_id`);--> statement-breakpoint
CREATE INDEX `child_ifsg_cases_facility` ON `child_ifsg_cases` (`facility_id`);--> statement-breakpoint
ALTER TABLE `facilities` ADD `ifsg_require_attest` integer DEFAULT false NOT NULL;