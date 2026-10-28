# Personalakte: Stammdaten, Lohn und Steuer, Dokumente

Stand: 28.10.2026 · Baut auf der Mitarbeiter-Seite (Reiter Stammdaten, Stunden & Vertrag, …), den Vertragsangaben,
den Notfallkontakten, den Rechten (`shared/domain/permissions.ts`, Teil 1) und den Löschfristen
(`2026-10-27-loeschfristen-design.md`, `2026-10-27-loeschuebersicht-design.md`) auf. Umsetzung nach Rechte Teil 1.

## 1. Ziel

Die Mitarbeiter-Seite wird zur digitalen Personalakte. Besonders schützenswerte Daten (Lohn, Steuer, Bank, Religion,
Schwerbehinderung, Verträge, Abmahnungen) sieht nur der Träger.

| Entschieden | |
|---|---|
| Sichtbarkeit | Träger alles; Leitung: Anschrift, Kontaktdaten, Geburtsdatum, Fach „Qualifikationen und Fortbildungen“; Mitarbeiter und Tablet: nichts davon (auch nicht die eigene Akte) |
| Pfändungen | nicht enthalten |
| Dokumente | hochgeladene Dateien (PDF, Foto) in Fächern |
| Löschfristen | Stammdaten sowie Lohn und Steuer sofort; Fächer Vertrag und Gehalt 10 Jahre; übrige Fächer 3 Jahre; Löschen nur von Hand (Mehr → Löschfristen) |

## 2. Stammdaten (Reiter „Stammdaten“, erweitert)

| Feld | sieht/pflegt |
|---|---|
| Geburtsdatum mit Jahr (der bestehende Geburtstag ohne Jahr bleibt für Tablet-Erinnerungen; mit Jahr ergibt er sich daraus) | Leitung, Träger |
| Anschrift (Straße, PLZ, Ort) | Leitung, Träger |
| Telefon, E-Mail | Leitung, Träger |
| Staatsangehörigkeit | Träger |
| Schwerbehinderung: ja/nein, Grad der Behinderung, „gleichgestellt“, gültig bis | Träger |

## 3. Reiter „Lohn und Steuer“ (nur Träger)

- Steuer-ID, Steuerklasse, Sozialversicherungsnummer, Krankenkasse, IBAN, Kontoinhaber, Konfession (Kirchensteuer).
- Anzeige zunächst verdeckt (z. B. „DE•• •••• •••• 1234“), „anzeigen“ zeigt den vollen Wert; Bearbeiten im Formular.
- Einfache Formatprüfung (IBAN-Prüfziffer, Steuer-ID 11 Ziffern, SV-Nummer 12 Zeichen) mit verständlichem Hinweis,
  Speichern trotzdem möglich nur bei gültigem Format oder leerem Feld.

## 4. Vertrag

- Neues Feld „befristet bis“ im Abschnitt „Vertragsangaben“, gleiche Sichtbarkeit wie die übrigen Vertragsangaben.

## 5. Reiter „Dokumente“

| Fach | sieht, lädt hoch, löscht | löschbar nach Ausscheiden |
|---|---|---|
| Vertrag und Nachträge, Stellenbeschreibung | Träger | 10 Jahre |
| Bewerbung (Lebenslauf, Zeugnisse, Führungszeugnis) | Träger | 3 Jahre |
| Qualifikationen und Fortbildungen | Leitung, Träger | 3 Jahre |
| Korrespondenz (Elternzeit, Teilzeit …) | Träger | 3 Jahre |
| Arbeitsrechtliche Maßnahmen (Abmahnung, Ermahnung) | Träger | 3 Jahre |
| Gehalt (Gehaltsentwicklung, Vorschüsse) | Träger | 10 Jahre |

- Je Dokument: Datei (PDF/JPG/PNG, Größenlimit wie bei den Kinderdokumenten), Titel, Datum, Notiz (freiwillig).
- Ansehen im Browser, Herunterladen, Löschen (mit Rückfrage). Dateien werden wie die Kinderdokumente gespeichert;
  nach dem Löschen WAL-Checkpoint.

## 6. Rechte

Neue Schlüssel im Katalog (Bereich Mitarbeiter), Grundeinstellung nur Träger, außer wo markiert:
- `employees.personal` – Anschrift, Kontakt, Geburtsdatum ansehen/pflegen (Leitung: ja);
- `employees.sensitive` – Staatsangehörigkeit, Schwerbehinderung;
- `employees.payroll` – Lohn und Steuer;
- `employees.docs.qualifications` (Leitung: ja), `employees.docs.contract`, `employees.docs.application`,
  `employees.docs.correspondence`, `employees.docs.measures`, `employees.docs.salary`.
Die Schlüssel sind vergebbar (nicht „fest beim Träger“); in Teil 2 kann der Träger sie weitergeben.

## 7. Löschfristen

- Kategorie „sofort“: alle Felder aus §2 und §3 (werden geleert), Dokumente: keine.
- Kategorie „Beurteilungen und Zeugnisse“ (3 Jahre): Fächer Bewerbung, Qualifikationen, Korrespondenz, Maßnahmen.
- Kategorie „ausgezahlte Überstunden“ (10 Jahre) bzw. eigene Zeile „Vertrag und Gehalt“ mit derselben Frist: Fächer
  Vertrag und Gehalt. Die Löschübersicht zeigt die Fächer in der passenden Zeile; der Mitarbeiter-Eintrag geht wie bisher
  zuletzt.

## 8. Tests

- Sichtbarkeit je Rolle (Leitung sieht §2-Teil und Fach Qualifikationen, sonst 403; Mitarbeiter/Tablet nichts).
- Formatprüfungen, verdeckte Anzeige (Server liefert vollen Wert nur mit `employees.payroll`).
- Dokumente: Upload, Ansehen, Löschen, Fach-Rechte, Facility-Scope.
- Löschfristen: neue Daten in den richtigen Kategorien, `categoryHasData`, FK-Prüfung.

## 9. Nicht enthalten

- Pfändungen, automatischer Zusatzurlaub bei Schwerbehinderung, Export an die Lohnbuchhaltung, Einsicht der Mitarbeiter
  in der App.
