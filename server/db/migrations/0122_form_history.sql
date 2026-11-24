-- „Verlauf“ of the child forms (server/services/childFormHistory.ts): the revisions of their answers and when a person last opened one.
CREATE TABLE `form_reads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`form_id` integer NOT NULL,
	`user_id` integer,
	`employee_id` integer,
	`opened_at` text NOT NULL,
	FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `form_reads_user` ON `form_reads` (`user_id`,`form_id`) WHERE user_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `form_reads_employee` ON `form_reads` (`employee_id`,`form_id`) WHERE employee_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `form_reads_form` ON `form_reads` (`form_id`);--> statement-breakpoint
CREATE TABLE `form_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`form_id` integer NOT NULL,
	`saved_at` text NOT NULL,
	`saved_by` text DEFAULT '' NOT NULL,
	`answers` text NOT NULL,
	`changed_item_ids` text DEFAULT '[]' NOT NULL,
	`initial` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `form_revisions_form` ON `form_revisions` (`form_id`,`id`);--> statement-breakpoint
-- The state before the history began: one initial revision per child form with at least one answer that says something
-- (not only empty texts – markup and spaces alone count as empty –, nothing ticked, no rating, milestones not reached, no dates, no remarks); it names no changed items.
INSERT INTO `form_revisions` (`form_id`, `saved_at`, `saved_by`, `answers`, `changed_item_ids`, `initial`)
	SELECT `id`, `updated_at`, `updated_by`, `answers`, '[]', 1 FROM `forms` WHERE `kind` = 'child' AND EXISTS (
		SELECT 1 FROM json_each(`forms`.`answers`) AS `a` WHERE NOT (
			`a`.`type` = 'null'
			OR (`a`.`type` = 'text' AND trim(replace(replace(replace(replace(`a`.`value`, '<p>', ''), '</p>', ''), '<br>', ''), '&nbsp;', ''),
				' ' || char(160) || char(9) || char(10) || char(13)) = '')
			OR (`a`.`type` = 'array' AND json_array_length(`a`.`value`) = 0)
			OR (`a`.`type` = 'object' AND json_extract(`a`.`value`, '$.value') IS NULL AND coalesce(json_extract(`a`.`value`, '$.reached'), 0) = 0
				AND trim(coalesce(json_extract(`a`.`value`, '$.remark'), '')) = '')
		)
	) ORDER BY `id`;