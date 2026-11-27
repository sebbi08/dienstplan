-- „nur Einsicht vermerken“ (Erweitertes Führungszeugnis, § 72a Abs. 5 SGB VIII), review round 1:
-- (1) required_inspection_log: who recorded, changed or deleted an inspection record and when (nothing of the content).
-- (2) required_inspections gets „Datum des Führungszeugnisses“ (certificate_date, required: the law lets the Träger store
--     the certificate's date, and the validity runs from it); „eingesehen am“ (inspected_on) becomes optional. Existing
--     records take the certificate date from their day of inspection (the only date there was); that day stays as well.
-- (3) A stable marker for files that must not be kept: employee_documents.inspection_cleanup (+ the type it was kept
--     for). Every file linked to a type „nur Einsicht vermerken“ gets it, so it stays on the cleanup list until it is
--     deleted, even if it is moved to another folder or unlinked. Nothing is deleted here.
-- drizzle-kit leaves out the ON DELETE of a column added with a reference; written by hand (as in the schema: set null).
CREATE TABLE `required_inspection_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`type_id` integer,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`type_id`) REFERENCES `required_document_types`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `required_inspection_log_employee` ON `required_inspection_log` (`employee_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_required_inspections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`type_id` integer NOT NULL,
	`certificate_date` text NOT NULL,
	`inspected_on` text,
	`no_relevant_entry` integer NOT NULL,
	`recorded_by` integer,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`type_id`) REFERENCES `required_document_types`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_required_inspections`("id", "employee_id", "type_id", "certificate_date", "inspected_on", "no_relevant_entry", "recorded_by", "recorded_at") SELECT "id", "employee_id", "type_id", "inspected_on", "inspected_on", "no_relevant_entry", "recorded_by", "recorded_at" FROM `required_inspections`;--> statement-breakpoint
DROP TABLE `required_inspections`;--> statement-breakpoint
ALTER TABLE `__new_required_inspections` RENAME TO `required_inspections`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `required_inspections_employee_type` ON `required_inspections` (`employee_id`,`type_id`);--> statement-breakpoint
CREATE INDEX `required_inspections_type` ON `required_inspections` (`type_id`);--> statement-breakpoint
ALTER TABLE `employee_documents` ADD `inspection_cleanup` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `employee_documents` ADD `inspection_type_id` integer REFERENCES required_document_types(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `employee_documents_inspection_type` ON `employee_documents` (`inspection_type_id`);--> statement-breakpoint
UPDATE `employee_documents` SET `inspection_cleanup` = 1, `inspection_type_id` = `required_type_id`
WHERE `required_type_id` IN (SELECT `id` FROM `required_document_types` WHERE `mode` = 'inspection');
