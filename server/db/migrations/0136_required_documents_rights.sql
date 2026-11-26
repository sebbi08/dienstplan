-- The switch „Dokumente Pflichtdokumente“ (`docsRequired`, key employees.docs.required; shared/domain/permissionBundles.ts):
-- by default on for the Leitung (like „Dokumente Qualifikationen“), off for Gruppenleitung and Mitarbeiter; the Träger
-- has every right. So that nobody loses a Pflichtdokument they saw before (they lay in „Qualifikationen“, „Bewerbung“,
-- „Vertrag“ or „Korrespondenz“), the switch is on exactly where „Dokumente Qualifikationen“ (`docsQualifications`) or
-- „alle übrigen Dokumente“ (`docsOther`, with Bewerbung) was on – for each role (its stored setting, else its default:
-- qualifications on for the Leitung only, the other documents for nobody) and for each person with an exception for one
-- of the two. A row is written only where that differs from the new default (role) or from the role (person).
INSERT INTO `role_bundles` ("role", "bundle", "enabled", "scope")
SELECT roles.role, 'docsRequired', roles.wanted, NULL FROM (
  SELECT defaults.role, defaults.base,
    (COALESCE((SELECT rb."enabled" FROM `role_bundles` rb WHERE rb."role" = defaults.role AND rb."bundle" = 'docsQualifications'), defaults.base)
      OR COALESCE((SELECT rb."enabled" FROM `role_bundles` rb WHERE rb."role" = defaults.role AND rb."bundle" = 'docsOther'), 0)) AS wanted
  FROM (SELECT 'admin' AS role, 1 AS base UNION ALL SELECT 'group_lead', 0 UNION ALL SELECT 'observer', 0) AS defaults
) AS roles
WHERE roles.wanted <> roles.base
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO `user_bundle_overrides` ("user_id", "bundle", "effect", "scope")
SELECT people.id, 'docsRequired', CASE WHEN people.wanted THEN 'grant' ELSE 'revoke' END, NULL FROM (
  SELECT u."id" AS id,
    (COALESCE(
      (SELECT CASE o."effect" WHEN 'grant' THEN 1 ELSE 0 END FROM `user_bundle_overrides` o WHERE o."user_id" = u."id" AND o."bundle" = 'docsQualifications'),
      (SELECT rb."enabled" FROM `role_bundles` rb WHERE rb."role" = u."role" AND rb."bundle" = 'docsQualifications'),
      CASE u."role" WHEN 'admin' THEN 1 ELSE 0 END)
    OR COALESCE(
      (SELECT CASE o."effect" WHEN 'grant' THEN 1 ELSE 0 END FROM `user_bundle_overrides` o WHERE o."user_id" = u."id" AND o."bundle" = 'docsOther'),
      (SELECT rb."enabled" FROM `role_bundles` rb WHERE rb."role" = u."role" AND rb."bundle" = 'docsOther'),
      0)) AS wanted,
    COALESCE((SELECT rb."enabled" FROM `role_bundles` rb WHERE rb."role" = u."role" AND rb."bundle" = 'docsRequired'),
      CASE u."role" WHEN 'admin' THEN 1 ELSE 0 END) AS role_has
  FROM `users` u
  WHERE u."role" IN ('admin', 'group_lead', 'observer')
    AND EXISTS (SELECT 1 FROM `user_bundle_overrides` o WHERE o."user_id" = u."id" AND o."bundle" IN ('docsQualifications', 'docsOther'))
) AS people
WHERE people.wanted <> people.role_has
ON CONFLICT DO NOTHING;
