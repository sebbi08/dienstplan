# Löschfristen: ausgeschiedene Mitarbeiter und archivierte Kassen

Stand: 27.10.2026 · Baut auf Mitarbeiter (Archiv der Ausgeschiedenen, „Endgültig löschen“), Zeiterfassung (Stundenkonto,
Ausgleiche), Mitarbeitergespräche, Kasse (Stilllegen, Protokoll) und dem täglichen Lauf (`server/services/dailyRun.ts`,
Löschfrist der Kinder) auf. Keine Rechtsberatung: die Fristen sind vorbelegt nach den Angaben des Trägers und änderbar.

## 1. Ziel

Personenbezogene Daten ausgeschiedener Mitarbeiter werden nach dem Ausscheiden gelöscht – sofort, soweit keine
Aufbewahrungsfrist gilt, sonst nach Ablauf der jeweiligen Frist, automatisch. Kassen werden nicht mehr gelöscht, sondern
archiviert und erst nach Ablauf der Aufbewahrungsfrist löschbar.

| Entschieden | |
|---|---|
| Fristbeginn (Mitarbeiter) | Ende des Kalenderjahres, in dem die Person ausgeschieden ist (`left_on`) |
| Fristen (vorbelegt, Träger änderbar) | Beurteilungen/Zeugnisse 3 Jahre · ausgezahlte Überstunden 10 Jahre · sonstige Überstunden-/Zeitdaten 2 Jahre · betriebliche Altersvorsorge 30 Jahre (keine Daten in der App) |
| Sofortiges „Endgültig löschen“ | Träger-Einstellung „Mitarbeiter endgültig löschen“: **aus** / **nur Träger** / **Leitung und Träger** (vorbelegt: Leitung und Träger, Probephase); Warnung, dass Fristen dabei nicht beachtet werden; „aus“ = nur noch automatische Löschung nach Fristen |
| Kasse | „Stilllegen“ heißt „Archivieren“; Archiv eingeklappt; endgültig löschen erst nach Ablauf der Aufbewahrungsfrist (vorbelegt 10 Jahre, Träger änderbar), Fristbeginn Ende des Jahres der letzten Buchung; Leitung und Träger löschen; Kasse ohne Buchung jederzeit löschbar |

## 2. Mitarbeiter: was wann gelöscht wird

Ausgeschieden = `left_on` gesetzt und vergangen (wie im Archiv der Mitarbeiter-Seite).

| Zeitpunkt | Daten |
|---|---|
| **Sofort** (am Tag nach `left_on`, täglicher Lauf) | Geburtstag, PIN und Sperrstatus, verknüpfter Zugang (Leitung/Mitarbeiter-Konto gelöscht; ein Träger-Konto wird nur gelöst), Qualifikation und Anrechnung, Vertragsdaten (Personalnummer, Entgeltgruppe, Tätigkeit, Beschäftigt seit, Wochenstunden-Verläufe …), Pflichttermin-Zuordnungen, Urlaubsanträge, Aushilfen, Benachrichtigungen, Freischaltungen für Beobachtungsbögen; als Bezugserzieher wird die Person bei Kindern entfernt |
| **„Sonstige Überstundendaten“** (vorbelegt 2 Jahre) | Dienstplan-Einträge und ihre Änderungsprotokolle, Stempelzeiten, Notizen/Markierungen der Zeiterfassung, „im Dienst erkrankt“, Stundenkonto-Daten, Ausgleiche ohne „ausgezahlt“, Krankheitstage, Urlaubskonten/-ansprüche |
| **„Beurteilungen und Zeugnisse“** (vorbelegt 3 Jahre) | Mitarbeitergespräche mit allen Bögen (Beurteilung, Selbstbeurteilung), Fortbildungsnachweise |
| **„Ausgezahlte Überstunden“** (vorbelegt 10 Jahre) | Ausgleiche mit Häkchen **„ausgezahlt“** (neues Feld am Ausgleich, beim Anlegen/Ändern setzbar) |
| **Altersvorsorge** (vorbelegt 30 Jahre) | keine Daten in der App; Einstellung nur zur Information |
| **Zuletzt** | der Mitarbeiter-Eintrag selbst (Name, Kürzel, Gruppe, Ausscheidedatum): sobald keine Daten mit laufender Frist mehr da sind |

- Was in freigegebenen Teamsitzungen oder Bögen anderer Personen nur als Text steht (z. B. „zuletzt geändert von …“), bleibt.
- Im Archiv der Mitarbeiter-Seite steht je Person: „Zeitdaten werden am ‹Datum› gelöscht, Beurteilungen am ‹Datum›,
  ausgezahlte Überstunden am ‹Datum›, danach der Eintrag.“
- Ein zurückgenommenes Ausscheiden (Datum entfernt/verschoben) stoppt künftige Löschungen; schon gelöschte Daten bleiben weg.
- Der tägliche Lauf schreibt in das Server-Protokoll, wie viele Datensätze je Art gelöscht wurden (keine Namen).

## 3. Einstellungen (Träger)

Neuer Abschnitt **„Löschfristen“** (Einstellungen → Personal, nur Träger, gilt je Einrichtung, „Einstellungen für“
funktioniert):
- vier Fristen in Jahren (1–40), vorbelegt 2 / 3 / 10 / 30, mit kurzer Erklärung je Zeile;
- **„Mitarbeiter endgültig löschen“**: aus / nur Träger / Leitung und Träger;
- **„Aufbewahrungsfrist Kasse“** in Jahren (1–30, vorbelegt 10).
Hinweis: „Die Fristen sind vorbelegt nach euren Vorgaben. Bitte im Zweifel mit Steuerberatung bzw. Datenschutz klären.“

## 4. Kasse

- „Stilllegen“ → **„Archivieren“**, „Wieder aktivieren“ bleibt. Archivierte Kassen im eingeklappten Bereich **„Archiv“**
  unter der Übersicht; lesbar, druckbar, keine Buchungen.
- Je archivierter Kasse: „löschbar ab ‹1.1. des Jahres nach letzter Buchung + Frist›“. Ab diesem Tag erscheint
  **„Endgültig löschen“** (Leitung und Träger) mit Eingabe des Kassennamens; gelöscht werden Kasse, Buchungen, Belege,
  abgeschlossene Monate und Protokoll. Gegenbuchungen von Umbuchungen in anderen Kassen bleiben als normale Buchung
  (Verknüpfung gelöst, Text bleibt).
- Kasse ohne jede Buchung: wie bisher sofort löschbar.
- Keine automatische Löschung bei Kassen (nur auf Knopfdruck nach Ablauf).

## 5. Technik (Überblick)

- Neue Spalten: `balance_adjustments.paid_out` (bool), Einstellungen je Einrichtung (Fristen, Löschstufe, Kassenfrist) —
  eine Migration.
- Reine Funktionen: Fälligkeitsdaten aus `left_on` und Fristen; Kassen-Löschbarkeit aus letzter Buchung und Frist.
- Service `employeeRetention` im täglichen Lauf (nach `purgeExpiredChildren`), in einer Transaktion je Mitarbeiter,
  FK-Prüfung; nutzt die Löschbausteine von „Endgültig löschen“.
- Rechte: Einstellungen nur Träger; „Endgültig löschen“ nach Löschstufe; Kassenlöschung Leitung/Träger nach Frist.

## 6. Tests

- Fälligkeiten (Ende des Jahres + Frist, Schaltjahre egal); sofortige Löschung am Tag nach `left_on`; jede Kategorie zum
  richtigen Tag; Eintrag zuletzt; zurückgenommenes Ausscheiden.
- „ausgezahlt“ hält Ausgleiche 10 Jahre, andere 2 Jahre.
- Löschstufe aus / nur Träger / Leitung und Träger.
- Kasse: Archivieren, „löschbar ab“, Löschen vor Ablauf 409, nach Ablauf ok, Gegenbuchungen bleiben.

## 7. Nicht enthalten

- Löschfristen für Kinderdaten (bestehen schon), Export für die Lohnbuchhaltung, betriebliche Altersvorsorge-Daten.
