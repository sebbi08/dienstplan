-- „Für ein weiteres Gespräch verwenden“ (server/services/staffTalks.ts): where a staff talk form was copied from; and „Verlauf“ for staff talk forms.
ALTER TABLE `forms` ADD `source_form_id` integer REFERENCES forms(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `forms` ADD `source_talk_date` text;--> statement-breakpoint
CREATE INDEX `forms_source` ON `forms` (`source_form_id`);--> statement-breakpoint
-- The state before the history began for the staff talk forms: one initial revision per form with at least one answer that
-- says something (as 0122 did for the child forms); it names no changed items.
INSERT INTO `form_revisions` (`form_id`, `saved_at`, `saved_by`, `answers`, `changed_item_ids`, `initial`)
	SELECT `id`, `updated_at`, `updated_by`, `answers`, '[]', 1 FROM `forms` WHERE `kind` = 'staff' AND EXISTS (
		SELECT 1 FROM json_each(`forms`.`answers`) AS `a` WHERE NOT (
			`a`.`type` = 'null'
			OR (`a`.`type` = 'text' AND trim(`a`.`value`) = '')
			OR (`a`.`type` = 'array' AND json_array_length(`a`.`value`) = 0)
			OR (`a`.`type` = 'object' AND json_extract(`a`.`value`, '$.value') IS NULL AND coalesce(json_extract(`a`.`value`, '$.reached'), 0) = 0
				AND trim(coalesce(json_extract(`a`.`value`, '$.remark'), '')) = '')
		)
	) ORDER BY `id`;