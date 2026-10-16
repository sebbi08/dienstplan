CREATE TABLE `opening_hours` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`group_id` integer,
	`weekday` integer NOT NULL,
	`open` integer,
	`close` integer,
	`closed` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `opening_hours_facility_weekday` ON `opening_hours` (`facility_id`,`weekday`) WHERE `group_id` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `opening_hours_group_weekday` ON `opening_hours` (`group_id`,`weekday`) WHERE `group_id` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `coverage_rules` ADD `weekdays` integer DEFAULT 31 NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `min_at_opening` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `min_at_closing` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `groups` ADD `min_at_opening` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `groups` ADD `min_at_closing` integer DEFAULT 1 NOT NULL;