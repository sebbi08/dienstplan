-- Filling PDF forms in the app: whether a stored PDF is a form with fields to fill („Ausfüllen“, „Weiter ausfüllen“),
-- judged once when the file is stored (server/lib/pdfForm.ts). Files of before stay NULL (not judged yet) until the
-- background run at startup judges them in small batches; only PDFs need judging, every other file is no form.
ALTER TABLE `print_templates` ADD `fillable` integer;--> statement-breakpoint
ALTER TABLE `child_documents` ADD `fillable` integer;--> statement-breakpoint
ALTER TABLE `employee_documents` ADD `fillable` integer;--> statement-breakpoint
UPDATE `print_templates` SET `fillable` = 0 WHERE `mime_type` <> 'application/pdf';--> statement-breakpoint
UPDATE `child_documents` SET `fillable` = 0 WHERE `mime_type` <> 'application/pdf';--> statement-breakpoint
UPDATE `employee_documents` SET `fillable` = 0 WHERE `mime_type` <> 'application/pdf';
