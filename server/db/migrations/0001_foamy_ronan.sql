CREATE TABLE `release_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`year` integer NOT NULL,
	`month` integer NOT NULL,
	`released_at` text NOT NULL,
	`released_by` integer,
	`data` text NOT NULL,
	FOREIGN KEY (`released_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `release_snapshots_month` ON `release_snapshots` (`year`,`month`);