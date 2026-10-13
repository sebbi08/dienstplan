CREATE TABLE `child_group_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`child_id` integer NOT NULL,
	`group_id` integer,
	`from_date` text,
	`keep_contacts` integer DEFAULT true NOT NULL,
	`keep_health` integer DEFAULT true NOT NULL,
	`keep_consents` integer DEFAULT true NOT NULL,
	`keep_documents` integer DEFAULT true NOT NULL,
	`keep_care_type` integer DEFAULT true NOT NULL,
	`keep_key_educator` integer DEFAULT true NOT NULL,
	`applied_at` text,
	`created_by` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `child_group_changes_child_date` ON `child_group_changes` (`child_id`,`from_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `child_group_changes_child_start` ON `child_group_changes` (`child_id`) WHERE `from_date` IS NULL;--> statement-breakpoint
CREATE INDEX `child_group_changes_group` ON `child_group_changes` (`group_id`);--> statement-breakpoint
ALTER TABLE `children` ADD `contacts_review_since` text;--> statement-breakpoint
ALTER TABLE `children` ADD `health_review_since` text;--> statement-breakpoint
ALTER TABLE `children` ADD `consents_review_since` text;--> statement-breakpoint
ALTER TABLE `children` ADD `documents_review_since` text;--> statement-breakpoint
ALTER TABLE `children` ADD `care_type_review_since` text;--> statement-breakpoint
ALTER TABLE `children` ADD `key_educator_review_since` text;--> statement-breakpoint
-- Every existing child gets the start entry of its group history: its current group from the beginning, applied.
INSERT INTO `child_group_changes` (`child_id`, `group_id`, `from_date`, `keep_contacts`, `keep_health`, `keep_consents`, `keep_documents`, `keep_care_type`, `keep_key_educator`, `applied_at`, `created_by`, `created_at`)
SELECT `id`, `group_id`, NULL, 1, 1, 1, 1, 1, 1, `created_at`, NULL, `created_at` FROM `children`;