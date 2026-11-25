CREATE TABLE `required_document_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`name` text NOT NULL,
	`folder` text NOT NULL,
	`applies_to` text DEFAULT 'all' NOT NULL,
	`validity_months` integer,
	`template_id` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `print_templates`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `required_document_types_facility` ON `required_document_types` (`facility_id`);--> statement-breakpoint
ALTER TABLE `employee_documents` ADD `required_type_id` integer REFERENCES required_document_types(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `employee_documents_required_type` ON `employee_documents` (`required_type_id`);--> statement-breakpoint
ALTER TABLE `sign_requests` ADD `required_type_id` integer REFERENCES required_document_types(id) ON DELETE set null;--> statement-breakpoint
-- Every facility starts with the example Pflichtdokumente (active; changeable and deletable), as a new facility does.
INSERT INTO `required_document_types` ("facility_id", "name", "folder", "validity_months", "sort_order")
SELECT `facilities`."id", examples.name, examples.folder, examples.validity, examples.sort FROM `facilities`, (
  SELECT 'Arbeitsvertrag' AS name, 'contract' AS folder, NULL AS validity, 0 AS sort UNION ALL
  SELECT 'Erweitertes Führungszeugnis' AS name, 'application' AS folder, 60 AS validity, 1 AS sort UNION ALL
  SELECT 'Masernnachweis' AS name, 'application' AS folder, NULL AS validity, 2 AS sort UNION ALL
  SELECT 'Belehrung Infektionsschutz' AS name, 'qualifications' AS folder, NULL AS validity, 3 AS sort UNION ALL
  SELECT 'Verpflichtung auf den Datenschutz' AS name, 'contract' AS folder, NULL AS validity, 4 AS sort UNION ALL
  SELECT 'Erste-Hilfe-Nachweis' AS name, 'qualifications' AS folder, 24 AS validity, 5 AS sort UNION ALL
  SELECT 'Schweigepflichterklärung' AS name, 'contract' AS folder, NULL AS validity, 6 AS sort
) AS examples
ORDER BY `facilities`."id", examples.sort;