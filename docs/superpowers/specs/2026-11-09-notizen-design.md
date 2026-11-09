# Notizen der Einrichtung

Stand: 09.11.2026 · Baut auf Gruppen (`groups`, Gruppenfarben), Rechte und Rollen (Schalter in
`shared/domain/permissionBundles.ts`, Umfang „eigene Gruppe“/„ganze Einrichtung“) und dem Menü (`app/utils/navMenu.ts`) auf.
Die zwei Info-Zeilen je Tag im Dienstplan (`day_notes`) bleiben unverändert.

## 1. Ziel

Eine Seite **„Notizen“**, auf der die Einrichtung Mitteilungen für das Team sammelt – für die ganze Einrichtung oder für eine
Gruppe: eine **Pinnwand** (ohne Datum) und **Tagesnotizen** (zu einem bestimmten Tag).

| Entschieden | |
|---|---|
| Arten | Pinnwand (optional „gilt bis“) und Tagesnotiz (ein Datum) |
| Für | ganze Einrichtung oder eine Gruppe der Einrichtung |
| Lesen | alle in der Einrichtung (Mitarbeiter, Gruppenleitung, Leitung, Träger, Kita-Tablet), alle Notizen; Filter nach Gruppe |
| Schreiben | neuer Schalter „Notizen schreiben“: Leitung ganze Einrichtung, Gruppenleitung eigene Gruppe, Mitarbeiter aus; Träger immer; einzelnen Personen per Ausnahme freigebbar |
| Anzeige | nur auf der Seite „Notizen“ (nicht im Dienstplan, nicht in „Mein Dienstplan“) |
| Löschen | nur von Hand; nichts wird automatisch gelöscht |

## 2. Die Seite

- Menüpunkt **„Notizen“** in der Hauptzeile für jede Person mit einer Einrichtung (wie „Teamsitzungen“) und am Kita-Tablet
  (Startseite bzw. Menü des Tablets).
- Oben ein Filter **„Gruppe“**: Alle / Einrichtung / jede Gruppe. „Einrichtung“ zeigt nur Notizen für die ganze Einrichtung;
  eine Gruppe zeigt die Notizen dieser Gruppe **und** die der ganzen Einrichtung.
- **Pinnwand:** die geltenden Notizen ohne Datum, neueste zuerst. Notizen mit „gilt bis“ vor heute stehen eingeklappt unter
  **„Abgelaufen“** (neueste zuerst).
- **Tagesnotizen:** ab heute aufsteigend nach Datum, mit Wochentag und Datum als Überschrift je Tag („Heute“ für heute).
  Frühere Tage eingeklappt unter **„Frühere Tage“** (neueste zuerst, die letzten 12 Monate; ältere über „Ältere anzeigen“).
- Jede Notiz zeigt: Text (Zeilenumbrüche bleiben), das Kennzeichen „Einrichtung“ oder den Gruppennamen in der Gruppenfarbe,
  „von ‹Name› am ‹Datum, Uhrzeit›“, bei Änderung „geändert von ‹Name› am …“, bei Pinnwand-Notizen ggf. „gilt bis ‹Datum›“.
- Wer schreiben darf, sieht **„Notiz anlegen“** und bei den Notizen, die sie/er ändern darf, Bearbeiten und Löschen (Löschen
  mit Rückfrage).
- Leere Bereiche: „Keine Notizen an der Pinnwand.“ / „Keine Tagesnotizen ab heute.“

## 3. Anlegen und Ändern

Felder: **Art** (Pinnwand / Tagesnotiz), **Für** (ganze Einrichtung / Gruppe), **Datum** (nur Tagesnotiz, Pflicht), **gilt
bis** (nur Pinnwand, freiwillig, nicht vor heute beim Anlegen), **Text** (Pflicht, 1–1000 Zeichen nach Entfernen von
Leerzeichen am Rand).

- Wer „Notizen schreiben“ mit Umfang **ganze Einrichtung** hat (Leitung, Träger): alle Notizen der Einrichtung anlegen,
  ändern, löschen.
- Mit Umfang **eigene Gruppe** (Gruppenleitung, oder eine Person mit Ausnahme): nur Notizen für die eigene Gruppe (die Gruppe
  des verknüpften Mitarbeiters); „Für“ ist dann fest diese Gruppe. Notizen der ganzen Einrichtung oder anderer Gruppen
  kann sie/er nur lesen. Ohne eigene Gruppe (Springer, kein verknüpfter Mitarbeiter) gibt es bei diesem Umfang nichts zu
  schreiben.
- Gespeichert werden Name und Zeitpunkt von Anlegen und letzter Änderung (Name als Text, wie bei Teamsitzungen; am Tablet
  wird nicht geschrieben).
- Fehler: leerer oder zu langer Text, fehlendes oder ungültiges Datum, Gruppe einer anderen Einrichtung, keine Berechtigung
  für diese Gruppe → verständliche deutsche Meldung.

## 4. Rechte

- Neuer Bereich **„Notizen“** auf der Seite „Rechte und Rollen“ mit dem Schalter **„schreiben“** (mit Umfang).
- Grundeinstellung: Leitung an (ganze Einrichtung), Gruppenleitung an (eigene Gruppe), Mitarbeiter aus. Bestehende
  Einrichtungen bekommen diese Grundeinstellung beim Update.
- Lesen braucht keinen Schalter: jede Person mit Einrichtung und das Kita-Tablet lesen die Notizen ihrer Einrichtung.
- Ausnahmen je Person wie bei den anderen Schaltern (Reiter „Zugang“); die Spalte „Sonderrechte“ der Mitarbeiter-Liste zeigt
  sie mit.

## 5. Daten

- Neue Tabelle `facility_notes`: `id`, `facility_id` (→ facilities, mit gelöscht), `group_id` (→ groups; leer = ganze
  Einrichtung), `kind` (`board` | `day`), `date` (Tagesnotiz, sonst leer), `valid_until` (Pinnwand, freiwillig), `text`,
  `created_at`, `created_by` (Name), `updated_at`, `updated_by` (Name, leer bis zur ersten Änderung).
- Wird eine Gruppe gelöscht, gelten ihre Notizen danach für die ganze Einrichtung (`group_id` auf leer).
- Keine automatische Löschung; die Notizen erscheinen nicht in der Löschübersicht (keine Aufbewahrungsfrist).

## 6. Tests

- Service: Anlegen/Ändern/Löschen je Umfang (Einrichtung, eigene Gruppe, fremde Gruppe abgelehnt, Springer ohne Gruppe),
  Prüfungen der Felder, Lesen für alle Rollen und das Tablet, fremde Einrichtung 404, Filter (Gruppe zeigt auch
  Einrichtungs-Notizen), Pinnwand „gilt bis“/Abgelaufen, Tagesnotizen ab heute/früher, gelöschte Gruppe.
- Rechte: neuer Schalter im Katalog und in den Grundeinstellungen (inkl. Migration bestehender Rollen-Einstellungen),
  Routen im Routen-Verzeichnis.
- Browser: Leitung legt Pinnwand- und Tagesnotiz an, Gruppenleitung nur für die eigene Gruppe, Mitarbeiterin liest.
