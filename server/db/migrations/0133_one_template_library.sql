-- One tab „Vorlagen“ (Dokumente): the categories of the form templates (Bögen, 0128_form_categories) merge into the
-- facility's categories of the PDF templates (template_categories), which then hold both kinds side by side.
-- Names are compared as the app compares them: app_fold_name() (server/db/client.ts registers it on every connection;
-- surrounding spaces, case with umlauts, ß/ss – SQLite's lower() knows only ASCII).
-- Per facility: a Bögen category whose name a PDF category of the same level has becomes that category – but only when
-- everyone sees it there („Wer sieht sie?“ = alle; for a subcategory its category is one such already). A Bogen must
-- stay as visible to those who fill it in as before (Bögen had no visibility), and a PDF must not become more visible,
-- so a Bögen category meeting a stricter one stays a category of its own. Every Bögen category that is not merged is
-- added, visible to all, after the facility's categories (after the category's subcategories) in the order it had.
-- Its name, the first that is free at its level (among the existing categories and the other new ones, by fold):
--   1. its own name;  2. „‹Name› (Bögen)“ (cut to 60 characters; among several that would end alike, the oldest Bögen
--   category gets it);  3. „‹Name› (Bögen ‹id›)“;  4. „Bögen ‹id›“.
-- The insert never fails (OR IGNORE): should even the last name be taken, the category is not created and its templates
-- stay without a category (none is lost; „Ohne Kategorie“). Each template moves to the category its own one became.
-- The order within a list counts both kinds together (shared/domain/templateEntries.ts): a Bogen's place moves up by
-- 1 000 000, so in a merged list the PDF templates stay first as they were and the Bögen follow in their order; the next
-- ▲/▼ or new entry numbers the whole list afresh.
CREATE TABLE `__form_category_map` (
	`form_id` integer PRIMARY KEY NOT NULL,
	`facility_id` integer NOT NULL,
	`parent_form_id` integer,
	`parent_target_id` integer,
	`name` text NOT NULL,
	`sort_order` integer NOT NULL,
	`target_id` integer,
	`c2` text,
	`c3` text,
	`c4` text,
	`new_name` text,
	`new_sort` integer
);
--> statement-breakpoint
CREATE TABLE `__template_category_max` AS SELECT coalesce(max(`id`), 0) AS `id` FROM `template_categories`;
--> statement-breakpoint
INSERT INTO `__form_category_map` (`form_id`, `facility_id`, `parent_form_id`, `parent_target_id`, `name`, `sort_order`, `target_id`)
	SELECT `f`.`id`, `f`.`facility_id`, NULL, NULL, trim(`f`.`name`), `f`.`sort_order`, (
		SELECT min(`t`.`id`) FROM `template_categories` AS `t` WHERE `t`.`facility_id` = `f`.`facility_id` AND `t`.`parent_id` IS NULL
			AND app_fold_name(`t`.`name`) = app_fold_name(`f`.`name`) AND `t`.`visibility` = 'all'
	) FROM `form_template_categories` AS `f` WHERE `f`.`parent_id` IS NULL;
--> statement-breakpoint
UPDATE `__form_category_map` SET
	`c2` = rtrim(substr(`name`, 1, 52)) || ' (Bögen)',
	`c3` = rtrim(substr(`name`, 1, 44)) || ' (Bögen ' || `form_id` || ')',
	`c4` = 'Bögen ' || `form_id`
WHERE `__form_category_map`.`parent_form_id` IS NULL AND `target_id` IS NULL;
--> statement-breakpoint
UPDATE `__form_category_map` SET `new_name` = CASE
	WHEN NOT EXISTS (SELECT 1 FROM `template_categories` AS `t` WHERE `t`.`facility_id` = `__form_category_map`.`facility_id` AND `t`.`parent_id` IS NULL AND app_fold_name(`t`.`name`) = app_fold_name(`__form_category_map`.`name`)) THEN `name`
	WHEN NOT EXISTS (SELECT 1 FROM `template_categories` AS `t` WHERE `t`.`facility_id` = `__form_category_map`.`facility_id` AND `t`.`parent_id` IS NULL AND app_fold_name(`t`.`name`) = app_fold_name(`__form_category_map`.`c2`))
		AND NOT EXISTS (SELECT 1 FROM `__form_category_map` AS `m2` WHERE `m2`.`facility_id` = `__form_category_map`.`facility_id` AND `m2`.`parent_form_id` IS NULL AND `m2`.`form_id` <> `__form_category_map`.`form_id`
			AND app_fold_name(`m2`.`name`) = app_fold_name(`__form_category_map`.`c2`))
		AND NOT EXISTS (SELECT 1 FROM `__form_category_map` AS `m2` WHERE `m2`.`facility_id` = `__form_category_map`.`facility_id` AND `m2`.`parent_form_id` IS NULL AND `m2`.`target_id` IS NULL
			AND `m2`.`form_id` < `__form_category_map`.`form_id` AND app_fold_name(`m2`.`c2`) = app_fold_name(`__form_category_map`.`c2`)
			AND EXISTS (SELECT 1 FROM `template_categories` AS `t` WHERE `t`.`facility_id` = `m2`.`facility_id` AND `t`.`parent_id` IS NULL AND app_fold_name(`t`.`name`) = app_fold_name(`m2`.`name`)))
		THEN `c2`
	WHEN NOT EXISTS (SELECT 1 FROM `template_categories` AS `t` WHERE `t`.`facility_id` = `__form_category_map`.`facility_id` AND `t`.`parent_id` IS NULL AND app_fold_name(`t`.`name`) = app_fold_name(`__form_category_map`.`c3`))
		AND NOT EXISTS (SELECT 1 FROM `__form_category_map` AS `m2` WHERE `m2`.`facility_id` = `__form_category_map`.`facility_id` AND `m2`.`parent_form_id` IS NULL AND app_fold_name(`m2`.`name`) = app_fold_name(`__form_category_map`.`c3`))
		THEN `c3`
	ELSE `c4`
END WHERE `__form_category_map`.`parent_form_id` IS NULL AND `target_id` IS NULL;
--> statement-breakpoint
UPDATE `__form_category_map` SET `new_sort` = (
	SELECT coalesce(max(`t`.`sort_order`), -1) FROM `template_categories` AS `t` WHERE `t`.`facility_id` = `__form_category_map`.`facility_id` AND `t`.`parent_id` IS NULL
) + (
	SELECT count(*) FROM `__form_category_map` AS `m2` WHERE `m2`.`facility_id` = `__form_category_map`.`facility_id` AND `m2`.`parent_form_id` IS NULL AND `m2`.`target_id` IS NULL
		AND (`m2`.`sort_order` < `__form_category_map`.`sort_order` OR (`m2`.`sort_order` = `__form_category_map`.`sort_order` AND `m2`.`form_id` <= `__form_category_map`.`form_id`))
) WHERE `__form_category_map`.`parent_form_id` IS NULL AND `target_id` IS NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO `template_categories` (`facility_id`, `parent_id`, `name`, `sort_order`, `visibility`)
	SELECT `facility_id`, NULL, `new_name`, `new_sort`, 'all' FROM `__form_category_map`
	WHERE `__form_category_map`.`parent_form_id` IS NULL AND `target_id` IS NULL ORDER BY `facility_id`, `new_sort`;
--> statement-breakpoint
UPDATE `__form_category_map` SET `target_id` = (
	SELECT `t`.`id` FROM `template_categories` AS `t` WHERE `t`.`facility_id` = `__form_category_map`.`facility_id` AND `t`.`parent_id` IS NULL AND `t`.`name` = `__form_category_map`.`new_name`
		AND `t`.`id` > (SELECT `id` FROM `__template_category_max`)
) WHERE `__form_category_map`.`parent_form_id` IS NULL AND `target_id` IS NULL;
--> statement-breakpoint
INSERT INTO `__form_category_map` (`form_id`, `facility_id`, `parent_form_id`, `parent_target_id`, `name`, `sort_order`, `target_id`)
	SELECT `f`.`id`, `f`.`facility_id`, `f`.`parent_id`, `p`.`target_id`, trim(`f`.`name`), `f`.`sort_order`, (
		SELECT min(`t`.`id`) FROM `template_categories` AS `t` WHERE `t`.`parent_id` = `p`.`target_id`
			AND app_fold_name(`t`.`name`) = app_fold_name(`f`.`name`) AND `t`.`visibility` = 'all'
	) FROM `form_template_categories` AS `f` JOIN `__form_category_map` AS `p` ON `p`.`form_id` = `f`.`parent_id`
	WHERE `f`.`parent_id` IS NOT NULL;
--> statement-breakpoint
UPDATE `__form_category_map` SET
	`c2` = rtrim(substr(`name`, 1, 52)) || ' (Bögen)',
	`c3` = rtrim(substr(`name`, 1, 44)) || ' (Bögen ' || `form_id` || ')',
	`c4` = 'Bögen ' || `form_id`
WHERE `__form_category_map`.`parent_form_id` IS NOT NULL AND `__form_category_map`.`parent_target_id` IS NOT NULL AND `target_id` IS NULL;
--> statement-breakpoint
UPDATE `__form_category_map` SET `new_name` = CASE
	WHEN NOT EXISTS (SELECT 1 FROM `template_categories` AS `t` WHERE `t`.`parent_id` = `__form_category_map`.`parent_target_id` AND app_fold_name(`t`.`name`) = app_fold_name(`__form_category_map`.`name`)) THEN `name`
	WHEN NOT EXISTS (SELECT 1 FROM `template_categories` AS `t` WHERE `t`.`parent_id` = `__form_category_map`.`parent_target_id` AND app_fold_name(`t`.`name`) = app_fold_name(`__form_category_map`.`c2`))
		AND NOT EXISTS (SELECT 1 FROM `__form_category_map` AS `m2` WHERE `m2`.`parent_target_id` = `__form_category_map`.`parent_target_id` AND `m2`.`parent_form_id` IS NOT NULL AND `m2`.`form_id` <> `__form_category_map`.`form_id`
			AND app_fold_name(`m2`.`name`) = app_fold_name(`__form_category_map`.`c2`))
		AND NOT EXISTS (SELECT 1 FROM `__form_category_map` AS `m2` WHERE `m2`.`parent_target_id` = `__form_category_map`.`parent_target_id` AND `m2`.`parent_form_id` IS NOT NULL AND `m2`.`target_id` IS NULL
			AND `m2`.`form_id` < `__form_category_map`.`form_id` AND app_fold_name(`m2`.`c2`) = app_fold_name(`__form_category_map`.`c2`)
			AND EXISTS (SELECT 1 FROM `template_categories` AS `t` WHERE `t`.`parent_id` = `m2`.`parent_target_id` AND app_fold_name(`t`.`name`) = app_fold_name(`m2`.`name`)))
		THEN `c2`
	WHEN NOT EXISTS (SELECT 1 FROM `template_categories` AS `t` WHERE `t`.`parent_id` = `__form_category_map`.`parent_target_id` AND app_fold_name(`t`.`name`) = app_fold_name(`__form_category_map`.`c3`))
		AND NOT EXISTS (SELECT 1 FROM `__form_category_map` AS `m2` WHERE `m2`.`parent_target_id` = `__form_category_map`.`parent_target_id` AND `m2`.`parent_form_id` IS NOT NULL AND app_fold_name(`m2`.`name`) = app_fold_name(`__form_category_map`.`c3`))
		THEN `c3`
	ELSE `c4`
END WHERE `__form_category_map`.`parent_form_id` IS NOT NULL AND `__form_category_map`.`parent_target_id` IS NOT NULL AND `target_id` IS NULL;
--> statement-breakpoint
UPDATE `__form_category_map` SET `new_sort` = (
	SELECT coalesce(max(`t`.`sort_order`), -1) FROM `template_categories` AS `t` WHERE `t`.`parent_id` = `__form_category_map`.`parent_target_id`
) + (
	SELECT count(*) FROM `__form_category_map` AS `m2` WHERE `m2`.`parent_target_id` = `__form_category_map`.`parent_target_id` AND `m2`.`parent_form_id` IS NOT NULL AND `m2`.`target_id` IS NULL
		AND (`m2`.`sort_order` < `__form_category_map`.`sort_order` OR (`m2`.`sort_order` = `__form_category_map`.`sort_order` AND `m2`.`form_id` <= `__form_category_map`.`form_id`))
) WHERE `__form_category_map`.`parent_form_id` IS NOT NULL AND `__form_category_map`.`parent_target_id` IS NOT NULL AND `target_id` IS NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO `template_categories` (`facility_id`, `parent_id`, `name`, `sort_order`, `visibility`)
	SELECT `facility_id`, `parent_target_id`, `new_name`, `new_sort`, 'all' FROM `__form_category_map`
	WHERE `__form_category_map`.`parent_form_id` IS NOT NULL AND `__form_category_map`.`parent_target_id` IS NOT NULL AND `target_id` IS NULL ORDER BY `facility_id`, `parent_target_id`, `new_sort`;
--> statement-breakpoint
UPDATE `__form_category_map` SET `target_id` = (
	SELECT `t`.`id` FROM `template_categories` AS `t` WHERE `t`.`parent_id` = `__form_category_map`.`parent_target_id` AND `t`.`name` = `__form_category_map`.`new_name`
		AND `t`.`id` > (SELECT `id` FROM `__template_category_max`)
) WHERE `__form_category_map`.`parent_form_id` IS NOT NULL AND `__form_category_map`.`parent_target_id` IS NOT NULL AND `target_id` IS NULL;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_form_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`category_id` integer,
	`kind` text NOT NULL,
	`subject` text,
	`name` text NOT NULL,
	`starter_key` text,
	`print_layout` text,
	`self_assessment` integer DEFAULT false NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `template_categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_form_templates`("id", "facility_id", "category_id", "kind", "subject", "name", "starter_key", "print_layout", "self_assessment", "archived", "sort_order", "content", "created_at", "updated_at", "updated_by")
	SELECT "id", "facility_id", (SELECT `m`.`target_id` FROM `__form_category_map` AS `m` WHERE `m`.`form_id` = `form_templates`.`category_id`),
		"kind", "subject", "name", "starter_key", "print_layout", "self_assessment", "archived", "sort_order" + 1000000, "content", "created_at",
		"updated_at", "updated_by"
	FROM `form_templates`;--> statement-breakpoint
DROP TABLE `form_templates`;--> statement-breakpoint
ALTER TABLE `__new_form_templates` RENAME TO `form_templates`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `form_templates_facility_kind` ON `form_templates` (`facility_id`,`kind`);--> statement-breakpoint
CREATE INDEX `form_templates_category` ON `form_templates` (`category_id`);--> statement-breakpoint
DROP TABLE `__form_category_map`;--> statement-breakpoint
DROP TABLE `__template_category_max`;--> statement-breakpoint
DROP TABLE `form_template_categories`;
