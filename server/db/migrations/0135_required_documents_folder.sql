-- The folder „Pflichtdokumente“ (`required`, with the key of „Bewerbung“: shared/domain/personnel.ts). Every
-- Pflichtdokument type moves there with its linked documents, so none flips to „fehlt“ – except:
--   * a type named „Arbeitsvertrag“ (any case): it stays where it is (salary data, the rights of „Vertrag“);
--   * a type in „Vertrag“, „Gehalt“ or „Arbeitsrechtliche Maßnahmen“ stays (unknown content), apart from the two examples
--     „Verpflichtung auf den Datenschutz“ and „Schweigepflichterklärung“ in „Vertrag“ (no salary data; „Vertrag“ and
--     „Bewerbung“ come with the same switch „alle übrigen Dokumente“, so nobody sees more than before).
-- Moved are the types in „Bewerbung“, „Qualifikationen und Fortbildungen“ and „Korrespondenz“ (and those two examples).
-- A linked document moves only if it lies in its type's folder (a stale link from another folder counted nowhere and
-- stays where it is); a sign request of a moved type files its signed copies into the new folder, and a request whose
-- source is a moved document keeps following that document's folder. Documents without a link stay where they are.
CREATE TEMP TABLE `moved_required_types` AS
SELECT `id`, `folder` FROM `required_document_types`
WHERE lower(trim(`name`)) <> 'arbeitsvertrag'
  AND (`folder` IN ('application', 'qualifications', 'correspondence')
    OR (`folder` = 'contract' AND lower(trim(`name`)) IN ('verpflichtung auf den datenschutz', 'schweigepflichterklärung', 'schweigepflichterklÄrung')));
--> statement-breakpoint
UPDATE `sign_requests` SET `source_folder` = 'required'
WHERE `source_document_id` IN (
  SELECT d.`id` FROM `employee_documents` d JOIN `moved_required_types` m ON m.`id` = d.`required_type_id` WHERE d.`folder` = m.`folder`
) AND `source_folder` = (
  SELECT d.`folder` FROM `employee_documents` d WHERE d.`id` = `sign_requests`.`source_document_id`
);
--> statement-breakpoint
UPDATE `employee_documents` SET `folder` = 'required'
WHERE `folder` = (SELECT m.`folder` FROM `moved_required_types` m WHERE m.`id` = `employee_documents`.`required_type_id`);
--> statement-breakpoint
UPDATE `sign_requests` SET `target_folder` = 'required'
WHERE `target_folder` = (SELECT m.`folder` FROM `moved_required_types` m WHERE m.`id` = `sign_requests`.`required_type_id`);
--> statement-breakpoint
UPDATE `required_document_types` SET `folder` = 'required' WHERE `id` IN (SELECT `id` FROM `moved_required_types`);
--> statement-breakpoint
DROP TABLE `moved_required_types`;
