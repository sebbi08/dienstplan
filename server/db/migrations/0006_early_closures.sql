CREATE TABLE `early_closures` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`closed_from` integer NOT NULL,
	`reason` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `early_closures_date_unique` ON `early_closures` (`date`);