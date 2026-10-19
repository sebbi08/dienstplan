# Essen je Einrichtung, Essensübersicht und neue Einwilligungen

Stand: 19.10.2026 · Baut auf Kinderakte (2026-10-08) und Anwesenheit der Kinder (2026-10-15) auf.

## 1. Ziel

1. **Essen festlegen**: Leitung und Träger legen pro Einrichtung fest, welche Essen es gibt (Name und Uhrzeit), statt
   der festen zwei „Snack“ und „Mittagessen“.
2. **Essensübersicht**: In der Anwesenheitsliste und im Ausdruck stehen die Gesamtzahl je Essen und eine kleine
   Übersicht je Gruppe.
3. **Einwilligungen**: neu „Darf mit Insektenschutz eingesprüht werden“ (mit Hinweis in der Infospalte bei „nein“);
   der doppelte Punkt „Fotos über WhatsApp versenden“ entfällt; neu „Fotos über Signal versenden“.

| Entschieden | |
|---|---|
| Wer legt Essen fest | Leitung und Träger, Einstellungen → Anwesenheit, je Einrichtung. |
| Ein Essen | Name (frei, 1–40 Zeichen, eindeutig in der Einrichtung) und Uhrzeit; Reihenfolge nach Uhrzeit. |
| Bestand | Snack (bisherige Snack-Uhrzeit) und Mittagessen (bisherige Mittag-Uhrzeit) mit allen Häkchen übernommen. |
| Änderungen | Neue Uhrzeit, neuer Name oder Löschen gelten erst ab einem Datum („gilt ab“, frühestens heute); vergangene Tage bleiben, wie sie waren. |
| Nachvollziehbar | Für jeden vergangenen Tag bleibt sichtbar, welche Essen es gab (Name, Uhrzeit) und welches Kind dafür gezählt wurde, automatisch oder von Hand. |
| Zählen | Unverändert: da zur Uhrzeit des Essens, oder für den Tag von Hand an/ab, „Wieder automatisch zählen“. |
| Übersicht | Kasten mit Gesamtzahl je Essen; Tabelle je Gruppe (Gruppe, Kinder da, je Essen). Digital und im Druck. |
| Insektenschutz | Neue Einwilligung ja/nein/offen; Infospalte „kein Insektenschutz“ nur bei „nein“. |
| WhatsApp/Signal | „Fotos über WhatsApp versenden“ (Datenschutz) entfällt, „Fotos über WhatsApp“ bleibt; neu „Fotos über Signal versenden“; Block heißt „Messenger (WhatsApp, Signal)“. |

## 2. Essen festlegen

- Abschnitt „Anwesenheit“ in den Einstellungen: statt der Felder „Uhrzeit Snack“ / „Uhrzeit Mittagessen“ eine Liste
  **„Essen“** mit Name und Uhrzeit je Zeile, „Essen hinzufügen“, Ändern, Löschen.
- Prüfungen: Name nicht leer, höchstens 40 Zeichen, nicht doppelt in der Einrichtung (Groß/Klein egal) → Fehler
  „Dieses Essen gibt es schon.“; gültige Uhrzeit; höchstens 8 Essen.
- Es darf auch kein Essen geben (dann keine Essensspalten und kein Essenskasten).
- **Vergangene Tage ändern sich nie.** Jede Änderung (Name, Uhrzeit, Löschen) bekommt ein Datum **„gilt ab“**
  (Voreinstellung heute, frühestens heute). Tage davor behalten Name und Uhrzeit von damals; dort wird weiter nach der
  alten Uhrzeit gezählt, und die Häkchen bleiben.
- Löschen heißt „ab ‹Datum› gibt es dieses Essen nicht mehr“ (Rückfrage: „‹Name› ab ‹Datum› entfernen? Frühere Tage
  bleiben unverändert.“). Für frühere Tage bleibt es mit allen Häkchen sichtbar.
- Ein neues Essen gilt ab dem gewählten Datum (frühestens heute).
- Die Einstellungen zeigen die heute gültigen Essen und darunter geplante Änderungen („ab 01.11.: Mittagessen 12:15“),
  die man wieder zurücknehmen kann.
- Neue Einrichtungen bekommen Snack 9:30 und Mittagessen 12:00 (wie bisher die Voreinstellung).

## 3. Anwesenheitsliste und Ausdruck

- Jedes Kind hat je Essen ein Häkchen (Reihenfolge nach Uhrzeit), mit „(von Hand)“ und „Wieder automatisch zählen“ wie
  bisher. Bei Kindern fremder Gruppen nur Anzeige (wie bisher).
- Oben **Kasten „Essen heute“**: je Essen „‹Name› ‹hh:mm›: ‹Zahl›“.
- Darunter **Tabelle je Gruppe**: Zeilen = Gruppen der Liste (Kinder ohne Gruppe als „ohne Gruppe“), Spalten = „Kinder
  da“ und je Essen die Zahl; letzte Zeile „Gesamt“. „Kinder da“ = gerade da oder heute schon gegangen (wie die
  bisherige Zählung).
- Ausdruck: je Essen eine Spalte mit ✓; über der Liste dieselbe Gesamt- und Gruppenübersicht.
- Für jeden Tag gelten die Essen, die **an diesem Tag** galten, mit Name und Uhrzeit von damals. So ist auch für
  vergangene Tage nachvollziehbar, welches Kind zu welchem Essen da war (und ob automatisch gezählt oder von Hand).
- Verlauf: Änderungen der Häkchen zeigen den Namen des Essens zum Zeitpunkt der Änderung.

## 4. Einwilligungen

- Neu in einem eigenen Block „Gesundheit“: **„Darf mit Insektenschutz eingesprüht werden“**
  (ja / nein / offen; neu angelegte und bestehende Kinder: offen).
- Infospalte der Anwesenheitsliste (Tablet und Ausdruck): bei „nein“ der Hinweis **„kein Insektenschutz“**.
- „Fotos über WhatsApp versenden“ (Block Datenschutz) entfällt. Vorhandene Werte werden übernommen: ist „Fotos über
  WhatsApp“ offen, gilt der Wert des entfallenden Punkts; widersprechen sich ja und nein, gilt **nein**.
- Neu **„Fotos über Signal versenden“** (offen). Der Block „WhatsApp“ heißt **„Messenger (WhatsApp, Signal)“**.
- Die Prüfungsliste „Offen“ (Akten mit offenen Einwilligungen) zählt die neuen Punkte wie die anderen.

## 5. Technik (Überblick)

- Neue Tabellen `meals` (Einrichtung cascade) und `meal_versions` (Essen cascade, gilt ab Datum (null = seit jeher),
  Name, Uhrzeit, oder „entfernt“): das an einem Tag gültige Essen ist die letzte Version mit gilt-ab ≤ Tag.
  `child_attendance_meals` (Anwesenheitstag cascade, Essen cascade, Wert ja/nein; keine Zeile = automatisch).
- Migration: je Einrichtung zwei Essen (Snack, Mittagessen) mit einer Version seit jeher aus `snack_time`/`lunch_time`;
  die Werte aus `child_attendance_days.snack`/`lunch` übernommen; danach entfallen diese Spalten.
- Verlauf: Feld `meal`, mit Essen-Id und Namen zum Zeitpunkt der Änderung.
- Einwilligungen: neue Spalten `consent_insect_repellent`, `consent_signal_photos`; `consent_photos_whatsapp` wird in
  `consent_whatsapp_photos` übernommen (Regel 4) und entfällt.
- Rechte unverändert: Essen festlegen `requireAdmin(`; Häkchen wie bisher.

## 6. Tests

- Essen anlegen/ändern/löschen, Prüfungen (doppelt, leer, Uhrzeit, mehr als 8, gilt ab in der Vergangenheit), andere
  Einrichtung → 404.
- Uhrzeit ab heute geändert: gestern wird weiter nach der alten Uhrzeit gezählt, heute nach der neuen; Name ab morgen
  geändert: heute alter Name; entfernt ab heute: gestern mit Häkchen sichtbar, heute nicht mehr; geplante Änderung
  zurücknehmen.
- Migration: zwei Essen mit den alten Uhrzeiten, Häkchen übernommen; Verlauf alter Einträge lesbar.
- Zählung je Essen (automatisch, von Hand, zurück auf automatisch).
- Übersicht: Gesamt und je Gruppe stimmen; keine Essen → keine Spalten.
- Einwilligungen: Übernahme-Regel (offen/ja/nein-Kombinationen), Infospalte „kein Insektenschutz“ nur bei nein.

## 7. Nicht enthalten

- Essen nur an bestimmten Wochentagen oder je Gruppe.
- Essensbestellung, Kosten, Abrechnung.
- Allergien je Essen (die Allergien stehen weiter in der Infospalte).
