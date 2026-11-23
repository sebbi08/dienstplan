DROP INDEX `knowledge_categories_facility_name`;--> statement-breakpoint
ALTER TABLE `knowledge_categories` ADD `parent_id` integer REFERENCES knowledge_categories(id);--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_categories_facility_parent_name` ON `knowledge_categories` (`facility_id`,(case when "parent_id" is null then 0 else "parent_id" end),lower("name"));--> statement-breakpoint
CREATE INDEX `knowledge_categories_parent` ON `knowledge_categories` (`parent_id`);--> statement-breakpoint
DROP INDEX `template_categories_facility_name`;--> statement-breakpoint
ALTER TABLE `template_categories` ADD `parent_id` integer REFERENCES template_categories(id);--> statement-breakpoint
CREATE UNIQUE INDEX `template_categories_facility_parent_name` ON `template_categories` (`facility_id`,(case when "parent_id" is null then 0 else "parent_id" end),lower("name"));--> statement-breakpoint
CREATE INDEX `template_categories_parent` ON `template_categories` (`parent_id`);--> statement-breakpoint
ALTER TABLE `knowledge_entries` ADD `subcategory_name` text;--> statement-breakpoint
ALTER TABLE `print_templates` ADD `subcategory_name` text;--> statement-breakpoint
INSERT INTO `knowledge_categories`("facility_id", "parent_id", "name", "sort_order", "visibility")
SELECT c."facility_id", c."id", 'Bund', 0, 'all'
FROM `knowledge_categories` c
WHERE c."parent_id" IS NULL AND lower(trim(c."name")) = 'gesetze & vorgaben'
AND EXISTS (SELECT 1 FROM `knowledge_starter_seeds` s WHERE s."facility_id" = c."facility_id" AND s."starter_key" = 'category:gesetze');--> statement-breakpoint
INSERT INTO `knowledge_categories`("facility_id", "parent_id", "name", "sort_order", "visibility")
SELECT c."facility_id", c."id", 'Baden-Württemberg', 1, 'all'
FROM `knowledge_categories` c JOIN `facilities` f ON f."id" = c."facility_id"
WHERE c."parent_id" IS NULL AND lower(trim(c."name")) = 'gesetze & vorgaben' AND f."state" = 'BW'
AND EXISTS (SELECT 1 FROM `knowledge_starter_seeds` s WHERE s."facility_id" = c."facility_id" AND s."starter_key" = 'category:gesetze');--> statement-breakpoint
UPDATE `knowledge_entries` SET "category_id" = (
	SELECT b."id" FROM `knowledge_categories` b WHERE b."parent_id" = `knowledge_entries`."category_id" AND b."name" = 'Bund'
)
WHERE "facility_id" IS NOT NULL AND "kind" = 'link'
AND EXISTS (SELECT 1 FROM `knowledge_categories` b WHERE b."parent_id" = `knowledge_entries`."category_id" AND b."name" = 'Bund')
AND (
	("starter_key" = 'link:sgb8-45' AND "title" = '§ 45 SGB VIII – Erlaubnis für den Betrieb einer Einrichtung'
		AND "description" = 'Die Betriebserlaubnis und ihre Voraussetzungen (gesetze-im-internet.de).'
		AND "url" = 'https://www.gesetze-im-internet.de/sgb_8/__45.html')
	OR ("starter_key" = 'link:sgb8-47' AND "title" = '§ 47 SGB VIII – Melde- und Dokumentationspflichten'
		AND "description" = 'Was der Träger der Aufsichtsbehörde melden muss, z. B. besondere Ereignisse (gesetze-im-internet.de).'
		AND "url" = 'https://www.gesetze-im-internet.de/sgb_8/__47.html')
);--> statement-breakpoint
UPDATE `knowledge_entries` SET "category_id" = (
	SELECT b."id" FROM `knowledge_categories` b WHERE b."parent_id" = `knowledge_entries`."category_id" AND b."name" = 'Baden-Württemberg'
)
WHERE "facility_id" IS NOT NULL AND "kind" = 'link'
AND EXISTS (SELECT 1 FROM `knowledge_categories` b WHERE b."parent_id" = `knowledge_entries`."category_id" AND b."name" = 'Baden-Württemberg')
AND "starter_key" = 'link:kitag-bw' AND "title" = 'Kindertagesbetreuungsgesetz Baden-Württemberg (KiTaG)'
AND "description" = 'Das Landesgesetz über die Betreuung und Förderung von Kindern in Kindertageseinrichtungen (Landesrecht BW).'
AND "url" = 'https://www.landesrecht-bw.de/bsbw/document/jlr-KiTaGBWrahmen';--> statement-breakpoint
INSERT INTO `knowledge_starter_seeds`("facility_id", "starter_key", "seeded_at")
SELECT s."facility_id", k."column1", strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `knowledge_starter_seeds` s CROSS JOIN (VALUES ('subcategory:gesetze-bund'), ('subcategory:gesetze-bw')) k
WHERE s."starter_key" = 'category:gesetze';
