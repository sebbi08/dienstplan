CREATE TABLE `facility_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`belongs_to` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `facility_contacts_facility` ON `facility_contacts` (`facility_id`);--> statement-breakpoint
ALTER TABLE `facilities` ADD `street` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `postal_code` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `city` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `website` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `operator_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `manager_name` text DEFAULT '' NOT NULL;