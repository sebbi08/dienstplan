-- „Erweitertes Führungszeugnis“: only the inspection is recorded (§ 72a Abs. 5 SGB VIII), no file kept. Pflichtdokument
-- types get a mode ('file' as before, 'inspection'), the inspections their own table (day, „keine einschlägige Eintragung“,
-- who and when). The example „Erweitertes Führungszeugnis“ – the name compared as the app compares names (trimmed,
-- regardless of case, umlauts included), in any folder – switches to 'inspection'; every other type keeps 'file'. Files
-- already linked to it stay (listed for deletion under Datenschutz & Löschen); nothing is deleted here.
CREATE TABLE `required_inspections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`type_id` integer NOT NULL,
	`inspected_on` text NOT NULL,
	`no_relevant_entry` integer NOT NULL,
	`recorded_by` integer,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`type_id`) REFERENCES `required_document_types`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `required_inspections_employee_type` ON `required_inspections` (`employee_id`,`type_id`);--> statement-breakpoint
CREATE INDEX `required_inspections_type` ON `required_inspections` (`type_id`);--> statement-breakpoint
ALTER TABLE `required_document_types` ADD `mode` text DEFAULT 'file' NOT NULL;--> statement-breakpoint
UPDATE `required_document_types` SET `mode` = 'inspection'
WHERE replace(replace(replace(lower(trim(`name`, ' ' || char(9, 10, 13, 160))), 'Ä', 'ä'), 'Ö', 'ö'), 'Ü', 'ü') = 'erweitertes führungszeugnis';
