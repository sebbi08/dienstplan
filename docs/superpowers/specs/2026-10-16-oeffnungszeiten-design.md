# Öffnungszeiten je Wochentag und passende Pflichtdienste

Stand: 16.10.2026 · Baut auf Einrichtungen (2026-10-07), Gruppen (2026-10-08) und Bundesland/Feiertage (2026-10-15) auf.

## 1. Ziel

Leitung und Träger legen pro Einrichtung für jeden Wochentag Öffnungs- und Schließzeit fest (oder „geschlossen“); jede
Gruppe kann auf Wunsch eigene Zeiten haben. Pflichtdienste gelten nur an den gewählten Wochentagen. Der Dienstplan warnt
zusätzlich, wenn zur Öffnung oder bis zur Schließung zu wenige Mitarbeiter eingeplant sind.

| Entschieden | |
|---|---|
| Öffnungszeiten | Pro Einrichtung, Mo–Fr je Öffnung/Schließung oder „geschlossen“; leer = nicht eingetragen (keine Rand-Warnung). |
| Gruppen | Optional eigene Öffnungszeiten (gleiche Tabelle); leer = es gelten die der Einrichtung. |
| Wer | Leitung und Träger (Einstellungen), pro Einrichtung. |
| Pflichtdienste | Häkchen Mo–Fr; bestehende gelten weiter an allen Werktagen. |
| Rand-Warnung | Zur Öffnung / bis zur Schließung mindestens N Mitarbeiter (N einstellbar, Voreinstellung 1). |
| Geschlossener Wochentag | Keine Pflichtdienst- und keine Rand-Warnungen. |
| Feiertage, Schließtage | Wie bisher nicht geprüft. |
| Bestand | Nichts eingetragen → keine neuen Warnungen; nichts ändert sich ungefragt. |

## 2. Öffnungszeiten

### 2.1 Einrichtung

- Neuer Abschnitt **„Öffnungszeiten“** in den Einstellungen (Leitung und Träger, aktive Einrichtung).
- Tabelle Montag bis Freitag: je **Öffnung** und **Schließung** (Uhrzeit), oder Häkchen **„geschlossen“**. Leer
  (beide Zeiten leer, nicht geschlossen) heißt „nicht eingetragen“.
- Dazu **„Mindestens zur Öffnung“** und **„Mindestens bis zur Schließung“** (Anzahl Mitarbeiter, 1–20, Voreinstellung 1).
- Prüfung: Schließung nach Öffnung (sonst Fehler „Die Schließzeit muss nach der Öffnungszeit liegen.“).

### 2.2 Gruppen

- Bei jeder Gruppe (im selben Abschnitt, aufklappbar) **„Eigene Öffnungszeiten“** mit derselben Tabelle und denselben
  Mindestzahlen. Leer = es gelten die Zeiten der Einrichtung; die Gruppe hat dann keine eigene Rand-Warnung.
- Hat eine Gruppe eigene Zeiten, prüft die Rand-Warnung der Gruppe nur Dienste dieser Gruppe (wie Gruppen-Pflichtdienste:
  eigene Gruppe des Dienstes, sonst die Stammgruppe des Mitarbeiters).

### 2.3 Anzeige im Dienstplan

Im Kopf jedes Tages steht klein die Öffnungszeit der Einrichtung („7:00–16:30“ bzw. „geschlossen“). Gruppen mit eigenen
Zeiten zeigen sie im Kopf ihres Gruppenblocks.

## 3. Pflichtdienste je Wochentag

- Jeder Pflichtdienst bekommt Häkchen **Mo Di Mi Do Fr** (mindestens eines). Bestehende Pflichtdienste: alle angehakt.
- Ein Pflichtdienst wird nur an seinen Wochentagen geprüft.
- An einem Wochentag, der als „geschlossen“ eingetragen ist (Einrichtung; für Gruppen-Pflichtdienste: die Gruppe, falls
  sie eigene Zeiten hat, sonst die Einrichtung), wird kein Pflichtdienst geprüft.

## 4. Rand-Warnung

- **Zur Öffnung**: Gezählt werden Dienste (Arbeitszeit, die als Personal zählt), die **spätestens zur Öffnung beginnen
  und nach der Öffnung enden**. Sind es weniger als die Mindestzahl: Warnung „‹hh:mm› Öffnung: ‹n› von ‹N› eingeplant“
  (bei 0: „niemand eingeplant“).
- **Bis zur Schließung**: Gezählt werden Dienste, die **vor der Schließung beginnen und frühestens zur Schließung
  enden**. Warnung entsprechend „‹hh:mm› Schließung: …“.
- Für die Einrichtung zählen alle Dienste des Plans (auch Aushilfen); für eine Gruppe mit eigenen Zeiten nur die Dienste
  dieser Gruppe (2.2). Die Warnung einer Gruppe nennt den Gruppennamen.
- Nicht geprüft: Wochenende, Feiertage (Bundesland der Einrichtung), Schließtage, Wochentage ohne eingetragene Zeiten,
  „geschlossen“.
- Die Warnungen erscheinen dort, wo heute die Pflichtdienst-Warnungen erscheinen (Dienstplan, Freigabe-Hinweise).

## 5. Technik (Überblick)

- Neue Tabelle `opening_hours`: `facility_id` (cascade), `group_id` (cascade, null = Einrichtung), `weekday` (0–4),
  `open` (Minuten, null), `close` (Minuten, null), `closed` (bool); unique (`facility_id`, `group_id`, `weekday`).
- Neue Spalten für die Mindestzahlen: auf `facilities` und `groups` (`min_at_opening`, `min_at_closing`, Voreinstellung 1).
- `coverage_rules.weekdays` (Bitmaske Mo–Fr, Voreinstellung alle).
- Domäne (`shared/domain/warnings.ts`): `dayWarnings` bekommt die Öffnungszeiten des Tages (Einrichtung + Gruppen) und
  prüft Pflichtdienste nur an ihren Wochentagen, dazu die Rand-Warnungen (neuer Warnungstyp `edge`).
- Rechte: lesen/schreiben Leitung und Träger (`requireAdmin(`).

## 6. Tests

- Pflichtdienst nur an angehakten Wochentagen; Bestand an allen Werktagen; „geschlossen“ unterdrückt Pflichtdienste.
- Rand-Warnung: Dienst 7:00–12:00 deckt Öffnung 7:00; Dienst 7:15–… deckt nicht; Dienst ganz vor der Öffnung endend
  zählt nicht; Schließung 16:30 mit Dienst bis 16:30 gedeckt, bis 16:00 nicht; Mindestzahl 2; Gruppe mit eigenen
  Zeiten zählt nur ihre Dienste; Gruppe ohne eigene Zeiten keine eigene Warnung; Feiertag/Schließtag/Wochenende/nicht
  eingetragen → keine Warnung.
- Bestand: ohne eingetragene Öffnungszeiten bleiben alle bisherigen Warnungen gleich (bestehende Tests grün).
- Einstellungen: Schließung vor Öffnung → Fehler; Gruppenzeiten einer anderen Einrichtung → 404.

## 7. Nicht enthalten

- Öffnungszeiten ab einem Datum (Änderungen gelten für alle Tage, auch rückwirkend für die Warnungen).
- Samstag/Sonntag-Öffnung.
- Prüfung über den ganzen Tag (lückenlose Besetzung zwischen Öffnung und Schließung).
