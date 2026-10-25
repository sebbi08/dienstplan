CREATE TABLE `setup_hidden` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`key` text NOT NULL,
	`hidden_at` text NOT NULL,
	`hidden_by` integer,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`hidden_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `setup_hidden_facility_key` ON `setup_hidden` (`facility_id`,`key`);