ALTER TABLE `maternity_cases` ADD `plan_sync` text;--> statement-breakpoint
ALTER TABLE `maternity_cases` ADD `miscarriage_on` text;--> statement-breakpoint
ALTER TABLE `maternity_cases` ADD `miscarriage_week` integer;--> statement-breakpoint
ALTER TABLE `maternity_cases` ADD `miscarriage_waived` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `retention_settings` ADD `maternity_years` integer DEFAULT 2 NOT NULL;