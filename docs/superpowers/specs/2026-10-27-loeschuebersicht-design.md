# Löschübersicht: nur noch manuell löschen, alles auf einer Seite

Stand: 27.10.2026 · Ersetzt die automatische Löschung aus `2026-10-27-loeschfristen-design.md` (Mitarbeiter) und die
automatische Löschung der Kinderakten. Fristen, Kategorien und Fälligkeitsdaten von dort gelten weiter – sie sagen jetzt,
ab wann gelöscht werden **darf**.

## 1. Ziel

Die App löscht nichts mehr von selbst. Der Träger sieht auf einer Seite alle Daten, die nach Ablauf einer Frist gelöscht
werden dürfen – schon fällige und künftige – und löscht sie dort von Hand.

| Entschieden | |
|---|---|
| Automatik | aus: kein nächtliches Löschen von Mitarbeiterdaten und Kinderakten mehr |
| Umfang | Mitarbeiterdaten (je Kategorie), Kinderakten, archivierte Kassen |
| Wer | nur der Träger sieht die Seite und löscht nach Fristen; die Leitung löscht nichts mehr nach Fristen |
| Einrichtungen | alle auf einer Seite, Spalte „Einrichtung“, Filter |
| Feinheit | eine Zeile je Person/Akte/Kasse und je Datenart, je Zeile ein Knopf, dazu „Alle fälligen löschen“ |
| Erinnerung | Kasten „Erinnerungen“ des Trägers: „‹n› Einträge dürfen gelöscht werden“ mit Link, bis gelöscht ist |
| Bleibt | sofortiges „Endgültig löschen“ für Probe-/Fehleinträge (Einstellung aus / nur Träger / Leitung und Träger); Löschen einer Kasse ohne jede Buchung und Geschichte durch Leitung/Träger wie bisher; Löschen einer Vormerkung (und eines noch nicht archivierten Kindes) durch Leitung/Träger; „Sofort löschen“ einer **archivierten** Kinderakte nur durch den Träger (Server: 403 `archived_child_provider_only` für die Leitung). Konto einer Leitung/eines Mitarbeiters ist ab dem Tag nach „ausgeschieden am“ gesperrt (Anmeldung `account_left`, laufende Sitzung 401), gelöscht wird es mit „Persönliche Daten“ (Final-Review-Ruling) |

## 2. Seite „Löschfristen“ (Mehr → Löschfristen, nur Träger)

Zeilen (Fälligkeit wie bisher berechnet; die Einstellungen gelten je Einrichtung, Kinderakten nach der Träger-Einstellung
der Kinder):

| Zeile | löschbar ab | gelöscht wird |
|---|---|---|
| ‹Person› – Persönliche Daten | Tag nach „ausgeschieden am“ | Kategorie „sofort“ (Geburtstag, PIN, Zugang, Vertrag, Qualifikation, Pflichttermine, Urlaubsanträge, Benachrichtigungen, Freischaltungen, Bezugserzieher) |
| ‹Person› – Zeitdaten | 1.1. nach Ende des Austrittsjahres + Frist „Sonstige Überstunden“ | Kategorie „Zeitdaten“ (inkl. Wochenstunden und Aushilfen) |
| ‹Person› – Beurteilungen | … + Frist „Beurteilungen“ | Mitarbeitergespräche, Fortbildungen |
| ‹Person› – ausgezahlte Überstunden | … + Frist „Ausgezahlte Überstunden“ | Ausgleiche mit „ausgezahlt“ (Zeile nur, wenn es welche gibt) |
| ‹Person› – Mitarbeiter-Eintrag | sobald alle anderen Zeilen der Person gelöscht sind (bzw. keine Daten mehr haben) | der Eintrag selbst |
| Kinderakte ‹Name› | wie bisher berechnet aus Austritt und Aufbewahrungsfrist der Kinder | die ganze Akte |
| Kasse ‹Name› (archiviert) | „löschbar ab“ wie bisher | Kasse mit Buchungen, Belegen, Monaten, Protokoll; Gegenbuchungen bleiben |

- Eine Zeile erscheint nur, wenn es dazu noch Daten gibt. Mitarbeiter erscheinen erst, wenn „ausgeschieden am“ vor heute
  liegt; ein zurückgenommenes Ausscheiden lässt die Zeilen verschwinden.
- Oben **„Jetzt löschbar (‹n›)“**: Zeilen mit Datum ≤ heute, je Zeile **„Löschen“**, dazu **„Alle fälligen löschen“**.
  Darunter **„Später löschbar“** nach Datum sortiert, ohne Knopf.
- Spalten: Einrichtung, Was (Name + Datenart), löschbar ab, Knopf. Filter „Einrichtung“ (alle / eine).
- Jedes Löschen fragt nach („… wird endgültig gelöscht. Lade vorher eine Datensicherung herunter.“). „Alle fälligen
  löschen“ zählt in der Abfrage auf, wie viele Zeilen je Art gelöscht werden, und löscht genau die angezeigten Zeilen
  (was inzwischen fällig wurde, bleibt bis zum nächsten Mal).
- Eine Kasse verlangt wie bisher die Eingabe ihres Namens; bei „Alle fälligen löschen“ genügt die eine Abfrage.

## 3. Was sich an bestehenden Stellen ändert

- Täglicher Lauf: `purgeExpiredChildren` und `runEmployeeRetention` laufen nicht mehr. Die Sonderregel beim automatischen
  Abmelden der Schulkinder („Kinder, deren Akte sofort gelöscht würde, werden übersprungen“) und das Abschalten des
  automatischen Abmeldens beim Ändern der Kinder-Aufbewahrungsfrist entfallen.
- Kasse: der Knopf „Endgültig löschen“ für archivierte Kassen entfällt auf der Kassenseite; „löschbar ab“ bleibt stehen.
  Das Löschen nach Frist nur noch durch den Träger (Übersicht).
- Texte „wird … gelöscht“ werden zu „darf … gelöscht werden“: Archiv der Mitarbeiter, Kinder-Archiv, Einstellungen
  „Löschfristen“ und „Aufbewahrung“ der Kinder, Anleitung (`docs/BETRIEB.md`), Übersicht der Rechte.
- Erinnerung: neuer Eintrag im Kasten „Erinnerungen“ nur für Träger, solange es fällige Zeilen gibt.

## 4. Technik (Überblick)

- Keine neue Tabelle. Ein Service berechnet die Zeilen über alle Einrichtungen (`retentionOverview(db, today)`), dieselben
  Löschbausteine wie bisher löschen je Zeile (eine Transaktion je Zeile, FK-Prüfung, WAL-Checkpoint).
- Routen nur für den Träger: Übersicht lesen, eine Zeile löschen (Art + Id), mehrere Zeilen löschen (Liste der
  angezeigten Zeilen). Vor dem Löschen wird die Fälligkeit serverseitig erneut geprüft (409, wenn nicht fällig).
- Die bisherige Kassen-Route zum Löschen nach Frist wird Träger-only bzw. von der neuen Route abgelöst.

## 5. Tests

- Nächtlicher Lauf löscht nichts mehr (Mitarbeiter und Kinder).
- Übersicht: richtige Zeilen und Daten je Kategorie, nur Zeilen mit Daten, alle Einrichtungen, Leitung 403.
- Löschen einer Zeile vor Fälligkeit 409, danach ok und nur diese Kategorie; Mitarbeiter-Eintrag erst als letzte Zeile.
- „Alle fälligen löschen“ löscht genau die übergebenen fälligen Zeilen.
- Erinnerung erscheint für den Träger bei fälligen Zeilen, nicht für die Leitung.

## 6. Nicht enthalten

- Export vor dem Löschen, Löschprotokoll mit Namen, Änderung der Fristen selbst.
