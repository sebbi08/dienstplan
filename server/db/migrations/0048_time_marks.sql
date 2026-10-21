ALTER TABLE `facilities` ADD `mark_tolerance_minutes` integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `mark_early_leave` integer DEFAULT true NOT NULL;