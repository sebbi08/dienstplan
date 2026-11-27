-- „nur Einsicht vermerken“ (Erweitertes Führungszeugnis, § 72a Abs. 5 SGB VIII), review round 2:
-- (1) required_document_types.certificate: „§ 72a SGB VIII (Führungszeugnis)“. Only such a type gets the law's texts and
--     its retention (deletable the day after leaving, gone 3 months after it, red past that); any other type „nur
--     Einsicht“ keeps the assessments' 3 years. Set here for the example „Erweitertes Führungszeugnis“, matched by name as
--     0138 did (trimmed, any case, Ä/Ö/Ü folded, any folder, any mode); the Träger changes it in the settings later,
--     renaming changes nothing.
-- (2) What an audit line (required_inspection_log) and a marked file (employee_documents.inspection_certificate) keep of
--     their type – name, folder, „§ 72a“ – so they keep their texts and their retention once the type is deleted or the
--     record is removed on a move to another facility. Filled from the type; lines and markers whose type is already gone
--     (could only be a deleted type „nur Einsicht“ since 0139, i.e. the Führungszeugnis) count as „§ 72a“: the shorter
--     retention errs on the side of deleting.
ALTER TABLE `employee_documents` ADD `inspection_certificate` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `required_document_types` ADD `certificate` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `required_inspection_log` ADD `type_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `required_inspection_log` ADD `folder` text;--> statement-breakpoint
ALTER TABLE `required_inspection_log` ADD `certificate` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `required_document_types` SET `certificate` = 1
WHERE replace(replace(replace(lower(trim(`name`, ' ' || char(9, 10, 13, 160))), 'Ä', 'ä'), 'Ö', 'ö'), 'Ü', 'ü') = 'erweitertes führungszeugnis';--> statement-breakpoint
UPDATE `required_inspection_log` SET
  `type_name` = (SELECT `name` FROM `required_document_types` WHERE `id` = `required_inspection_log`.`type_id`),
  `folder` = (SELECT `folder` FROM `required_document_types` WHERE `id` = `required_inspection_log`.`type_id`),
  `certificate` = (SELECT `certificate` FROM `required_document_types` WHERE `id` = `required_inspection_log`.`type_id`)
WHERE `type_id` IS NOT NULL;--> statement-breakpoint
UPDATE `required_inspection_log` SET `certificate` = 1 WHERE `type_id` IS NULL;--> statement-breakpoint
UPDATE `employee_documents` SET `inspection_certificate` = coalesce(
  (SELECT `certificate` FROM `required_document_types` WHERE `id` = `employee_documents`.`inspection_type_id`), 1)
WHERE `inspection_cleanup` = 1;
