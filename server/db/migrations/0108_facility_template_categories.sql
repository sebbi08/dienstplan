PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_template_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`visibility` text DEFAULT 'all' NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_template_categories`("facility_id", "name", "sort_order", "visibility")
SELECT f."id", c."name", c."position" + 2, c."visibility"
FROM `facilities` f CROSS JOIN (
	SELECT "name", "visibility", row_number() OVER (ORDER BY "sort_order", "id") - 1 AS "position" FROM `template_categories`
) c
ORDER BY f."id", c."position";--> statement-breakpoint
INSERT INTO `__new_template_categories`("facility_id", "name", "sort_order", "visibility")
SELECT f."id", n."column1", n."column2", 'all'
FROM `facilities` f CROSS JOIN (VALUES ('Eingewöhnungsmappe', 0), ('Mitarbeitermappe', 1)) n
WHERE NOT EXISTS (
	SELECT 1 FROM `__new_template_categories` e WHERE e."facility_id" = f."id"
	AND replace(replace(replace(replace(replace(lower(trim(e."name")), 'Ä', 'ä'), 'Ö', 'ö'), 'Ü', 'ü'), 'ẞ', 'ß'), 'ß', 'ss')
		= replace(replace(replace(replace(replace(lower(trim(n."column1")), 'Ä', 'ä'), 'Ö', 'ö'), 'Ü', 'ü'), 'ẞ', 'ß'), 'ß', 'ss')
)
ORDER BY f."id", n."column2";--> statement-breakpoint
CREATE TABLE `__new_print_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer,
	`title` text NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`category_id` integer,
	`category_name` text,
	`visibility` text DEFAULT 'all' NOT NULL,
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
INSERT INTO `__new_print_templates`("id", "facility_id", "title", "category", "category_id", "category_name", "visibility", "mime_type", "size", "data", "uploaded_by", "uploaded_at", "updated_at")
SELECT p."id", p."facility_id", p."title", p."category",
	CASE WHEN p."facility_id" IS NULL THEN NULL ELSE (
		SELECT n."id" FROM `__new_template_categories` n JOIN `template_categories` o ON o."name" = n."name"
		WHERE o."id" = p."category_id" AND n."facility_id" = p."facility_id"
	) END,
	CASE WHEN p."facility_id" IS NULL THEN (SELECT o."name" FROM `template_categories` o WHERE o."id" = p."category_id") END,
	CASE WHEN p."facility_id" IS NULL THEN coalesce((SELECT o."visibility" FROM `template_categories` o WHERE o."id" = p."category_id"), 'all') ELSE 'all' END,
	p."mime_type", p."size", p."data", p."uploaded_by", p."uploaded_at", p."updated_at"
FROM `print_templates` p;--> statement-breakpoint
DROP TABLE `print_templates`;--> statement-breakpoint
DROP TABLE `template_categories`;--> statement-breakpoint
ALTER TABLE `__new_template_categories` RENAME TO `template_categories`;--> statement-breakpoint
ALTER TABLE `__new_print_templates` RENAME TO `print_templates`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `template_categories_facility_name` ON `template_categories` (`facility_id`,lower("name"));--> statement-breakpoint
CREATE INDEX `print_templates_facility` ON `print_templates` (`facility_id`);--> statement-breakpoint
CREATE INDEX `print_templates_category` ON `print_templates` (`category_id`);
