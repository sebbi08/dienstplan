CREATE TABLE `template_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`visibility` text DEFAULT 'all' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `template_categories_name` ON `template_categories` (lower("name"));--> statement-breakpoint
INSERT INTO `template_categories`("name", "sort_order", "visibility") SELECT min("name"), row_number() OVER (ORDER BY lower(min("name"))) - 1, 'all' FROM (SELECT coalesce(nullif(trim("category"), ''), 'Sonstiges') AS "name" FROM `print_templates`) GROUP BY lower("name");--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_print_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer,
	`title` text NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`category_id` integer NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`data` blob NOT NULL,
	`uploaded_by` integer,
	`uploaded_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `template_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_print_templates`("id", "facility_id", "title", "category", "category_id", "mime_type", "size", "data", "uploaded_by", "uploaded_at", "updated_at") SELECT "id", "facility_id", "title", "category", (SELECT `template_categories`."id" FROM `template_categories` WHERE lower(`template_categories`."name") = lower(coalesce(nullif(trim(`print_templates`."category"), ''), 'Sonstiges'))), "mime_type", "size", "data", "uploaded_by", "uploaded_at", "updated_at" FROM `print_templates`;--> statement-breakpoint
DROP TABLE `print_templates`;--> statement-breakpoint
ALTER TABLE `__new_print_templates` RENAME TO `print_templates`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `print_templates_facility` ON `print_templates` (`facility_id`);--> statement-breakpoint
CREATE INDEX `print_templates_category` ON `print_templates` (`category_id`);
