-- Own categories (one level of subcategories) for the form templates (Dokumente → Bögen, server/services/formTemplateCategories.ts).
CREATE TABLE `form_template_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`parent_id` integer,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `form_template_categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `form_template_categories_facility_parent_name` ON `form_template_categories` (`facility_id`,(case when "parent_id" is null then 0 else "parent_id" end),lower("name"));--> statement-breakpoint
CREATE INDEX `form_template_categories_parent` ON `form_template_categories` (`parent_id`);--> statement-breakpoint
ALTER TABLE `form_templates` ADD `category_id` integer REFERENCES form_template_categories(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
CREATE INDEX `form_templates_category` ON `form_templates` (`category_id`);--> statement-breakpoint
-- Every facility gets the example categories named like the former groups of the kinds (all six, also empty ones: a facility
-- deletes what it does not need), each template is filed into the one of its kind; the order within stays as it was (each
-- category holds one kind, whose order it had). The marker in form_starter_seeds keeps deleted examples from coming back.
INSERT INTO `form_template_categories` (`facility_id`, `parent_id`, `name`, `sort_order`)
	SELECT `f`.`id`, NULL, `k`.`name`, `k`.`ord` FROM `facilities` AS `f` CROSS JOIN (
		SELECT 'Kinder' AS `name`, 0 AS `ord` UNION ALL SELECT 'Fachkräfte', 1 UNION ALL SELECT 'Team', 2
		UNION ALL SELECT 'Unfälle', 3 UNION ALL SELECT 'Infogespräche', 4 UNION ALL SELECT 'Hospitationen', 5
	) AS `k` ORDER BY `f`.`id`, `k`.`ord`;--> statement-breakpoint
UPDATE `form_templates` SET `category_id` = (
	SELECT `c`.`id` FROM `form_template_categories` AS `c` WHERE `c`.`facility_id` = `form_templates`.`facility_id` AND `c`.`parent_id` IS NULL
		AND `c`.`name` = CASE `form_templates`.`kind` WHEN 'child' THEN 'Kinder' WHEN 'staff' THEN 'Fachkräfte' WHEN 'team' THEN 'Team'
			WHEN 'accident' THEN 'Unfälle' WHEN 'info' THEN 'Infogespräche' WHEN 'applicant' THEN 'Hospitationen' END
);--> statement-breakpoint
INSERT INTO `form_starter_seeds` (`facility_id`, `starter_key`, `seeded_at`)
	SELECT `id`, 'categories', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM `facilities`;
