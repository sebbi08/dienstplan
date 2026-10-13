ALTER TABLE `facilities` ADD `school_cutoff_month` integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `school_cutoff_day` integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `school_age_years` integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE `groups` ADD `capacity` integer;