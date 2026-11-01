# Rechte Teil 2 – offene Punkte aus Teil 1

Gesammelt aus den Reviews von Teil 1 (Plan `2026-10-28-rechte-teil1.md`). Für den Bauplan von Teil 2 (Seite „Rechte und
Rollen“) und Teil 3 (Gruppenleitung) berücksichtigen.

## Muss mit Teil 2 erledigt werden (sonst wirken Ausnahmen je Person nicht)

- `rolePermissions(db, role)` statt der Rechte der Person: printTemplates (TemplateActor, listTemplates),
  employees (mayViewContract / Vertragsfelder), groupReadAccess (readAccessFacility), groups (Kapazität, listChildGroups).
  Diese Stellen müssen die Rechte der handelnden Person bekommen (Testaufrufe anpassen).
- Mitarbeiter-Liste (`server/api/employees/index.get.ts`) übergibt noch `viewer.role`, die Detailseite schon
  `viewer.permissions` – angleichen.
- `getLeaveSettings` rechnet `accountPermissions` neu statt `viewer.permissions` zu nutzen (zwei Quellen).
- Gespeicherte Rechte-Schlüssel aus der Datenbank vor `resolvePermissions` filtern (unbekannte Schlüssel werfen heute).
- `can_edit_children` setzt heute die Leitung (Benutzer-Seite, Zugang); nach Spec setzt Rechte nur der Träger →
  in Ausnahmen je Person überführen.
- `contract_visible_to_admins` und `leave_planners` sind faktisch Rechte-Vergaben → in Rollen-/Personen-Rechte überführen
  (leave_planners für Träger-Konten bleibt Benachrichtigungs-Empfänger).

## Passende Schlüssel nachziehen

- `facilities.get` (Einrichtungsname im Kopf) hängt an `settings.facility` – braucht jeder Angemeldete.
- Client: GroupNameSection „für Schulkinder“ nutzt `settings.groups`, Route braucht `children.schoolSettings`;
  Mitarbeiter-Übersicht Vertragshinweis nutzt `rights.manage` statt `employees.contractView/Edit`;
  `app/utils/routeAccess.ts` `/terminal` und `/admin`-Fallback auf `settings.facility`; `templates.vue` Variablennamen.
- Menü: wer einen Büro-Schlüssel bekommt (z. B. `calendar.edit`), bekommt das Büro-Menü – beim Seitenentwurf beachten.

## Aufräumen / Tests

Alles Interne aus diesem Abschnitt ist erledigt (Tablet-Modell einmal in `shared/domain/permissions.ts` und dem Script,
Route-Walk und Akteurliste aus dem Script importiert, `stripComments` als kleiner Tokenizer, alle Katalog-Kanten per Test
festgehalten, Rollenprüfungs-Test, `requireChildPermission`-/Facility-Modus-Tests, tabletUnlock mit einer Rechte-Abfrage).

## Andere offene Punkte (nicht Rechte)

- Überstundenfrei: ÜF mit Uhrzeit zählt in der Urlaubsplanung als ganze Person abwesend; ÜF im Jahreskalender und auf
  der Zeiterfassungs-Seite nicht eintragbar/entfernbar; Vorschau für schon geplante ÜF-Tage mit Uhrzeit allein in der
  Zelle zählt nur die ÜF-Minuten.
