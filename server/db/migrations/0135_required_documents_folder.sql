-- The folder „Pflichtdokumente“ (`required`, its own key employees.docs.required since 0136: shared/domain/personnel.ts).
-- Moved there, each with its linked documents so none flips to „fehlt“, are only types whose content is known:
--   * every type in „Qualifikationen und Fortbildungen“ (whoever saw that folder gets the new one, 0136);
--   * from „Bewerbung“ and „Korrespondenz“ only the examples „Erweitertes Führungszeugnis“ and „Masernnachweis“;
--   * from „Vertrag“ only the examples „Verpflichtung auf den Datenschutz“ and „Schweigepflichterklärung“ (no salary data).
-- Everything else stays where it is – own types in Bewerbung, Korrespondenz, Vertrag, Gehalt and Arbeitsrechtliche
-- Maßnahmen (unknown content: the new folder's readers are not theirs) and a type named „Arbeitsvertrag“ anywhere.
-- Names are compared as the app compares them (trimmed, regardless of case, umlauts included).
-- A linked document moves only if it lies in its type's folder (a stale link from another folder counted nowhere and
-- stays where it is); a sign request of a moved type files its signed copies into the new folder, and a request whose
-- source is a moved document keeps following that document's folder. Documents without a link stay where they are.
CREATE TEMP TABLE `moved_required_types` AS
SELECT `id`, `folder` FROM (
  SELECT `id`, `folder`,
    replace(replace(replace(lower(trim(`name`, ' ' || char(9, 10, 13, 160))), 'Ä', 'ä'), 'Ö', 'ö'), 'Ü', 'ü') AS folded
  FROM `required_document_types`
)
WHERE folded <> 'arbeitsvertrag'
  AND (`folder` = 'qualifications'
    OR (`folder` IN ('application', 'correspondence') AND folded IN ('erweitertes führungszeugnis', 'masernnachweis'))
    OR (`folder` = 'contract' AND folded IN ('verpflichtung auf den datenschutz', 'schweigepflichterklärung')));
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
