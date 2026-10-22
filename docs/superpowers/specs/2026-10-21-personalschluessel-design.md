# Personalschlüssel je Gruppe und Einrichtung (alle Bundesländer)

Stand: 21.10.2026 · Baut auf Einrichtungen/Bundesland (2026-10-15), Gruppen, Belegung/Verträge (2026-10-13),
Betreuungsformen, Öffnungszeiten (2026-10-16) und Dienstplan auf. Recherche: `.superpowers/sdd/personalschluessel-research.md`
(16 Länder, Stand Oktober 2026, mit Quellen und Unsicherheiten).

## 1. Ziel

Die App berechnet je Gruppe und je Einrichtung, wie viel pädagogisches Personal nach den Vorgaben des Bundeslands nötig
ist, und vergleicht das mit dem eingeplanten Personal. Ist es zu wenig, zeigt sie das an: im Monat (neuer Reiter
„Personalschlüssel“) und – wo das Land eine Mindestbesetzung nach Uhrzeit verlangt – als Warnung im Dienstplan.

| Entschieden | |
|---|---|
| Regeln | Je Einrichtung nach ihrem Bundesland; alle Zahlen als Vorgabe des Landes vorbelegt, vom Träger änderbar. |
| Unsichere Länder | Saarland, Hamburg (aktuelle Werte), teils Mecklenburg-Vorpommern und Thüringen: Hinweis „bitte prüfen“. |
| Kinder | Laut Vertrag (Belegung) im jeweiligen Monat bzw. Tag, mit Alter und Betreuungsform. |
| U3-Gewichtung | Je Land vorbelegt (z. B. Bayern 2,0), einstellbar. |
| Personal | Eingeplante Arbeitszeit im Dienstplan, gewichtet nach Qualifikation/Anrechnung des Mitarbeiters. |
| Qualifikation | Bei jedem Mitarbeiter von Leitung/Träger einzutragen: Fachkraft, Ergänzungs-/Zusatzkraft, Auszubildende/r (mit Ausbildungsjahr), Praktikant/in, keine pädagogische Kraft; dazu „Anrechnung in %“ (vorbelegt nach Land, änderbar). |
| Gruppenart | Bei jeder Gruppe, nur in Ländern, die danach rechnen (BW, NI, SL, NW): Auswahl je Land (z. B. BW Regelgruppe, VÖ, Ganztag, Krippe). |
| Anzeige | Reiter „Personalschlüssel“ unter „Kinder“ (Leitung/Träger); Warnungen im Dienstplan mit Uhrzeit. |
| Haftung | Planungshilfe, keine rechtliche Prüfung; der Hinweis steht im Reiter und in den Einstellungen. |

## 2. Rechenarten

Jede Länder-Vorgabe gehört zu einer Rechenart (Details und Zahlen je Land in der Recherche, Abschnitt „How each Land
maps to the model“):

| Rechenart | Länder | Soll |
|---|---|---|
| Kinder je Vollzeitkraft | BE, BB, SN, MV, TH, RP (je Platz) | Summe über Kinder: 1 ÷ (Kinder je Vollzeitkraft für Altersband × Betreuungsumfang) |
| Gewichtete Buchungsstunden | BY, HE, ST, SH, HH | Summe über Kinder: Wochenstunden × Gewicht × Faktor (z. B. BY 1 Stunde je 11 gewichtete Buchungsstunden) |
| Vollzeitkräfte je Gruppe | BW, NI, SL | je Gruppe nach Gruppenart (z. B. BW Regelgruppe 1,8), angepasst an die Öffnungszeit, wo das Land das vorsieht |
| Stundenpauschale je Gruppenform | NW | Wochenstunden je Gruppenform und Betreuungsumfang (25/35/45 h) |

- **Wochenstunden eines Kindes** = Betreuungsform (Beginn–Ende) × Tage pro Woche (neues Feld an der Betreuungsform,
  Voreinstellung 5). Kinder ohne Betreuungsform: Hinweis „Betreuungsform fehlt“, zählen nicht.
- **Altersband** am jeweiligen Tag/Monatsersten (unter 3, 3 bis Schule, Schulkind).
- **Zuschläge** des Landes (Leitung, Ausfall, Verfügung) werden als eigene Zeilen gezeigt (z. B. „Leitungszeit: Soll
  8 h/Woche“); Leitungszeit wird in diesem Schritt angezeigt, aber nicht gegen den Plan geprüft.
- **Vollzeit** = Wochenstunden laut Land (vorbelegt 39, änderbar).
- **Ist** = eingeplante Arbeitsstunden des Monats der Mitarbeiter mit Wirkung in der Gruppe (Dienst der Gruppe, sonst
  Stammgruppe) × Anrechnung, umgerechnet in Vollzeitkräfte; Abwesenheiten zählen nicht. Für die Einrichtung: alle.
- **Fachkraftquote** (wo das Land sie hat, z. B. BY ≥ 50 % Fachkräfte): eigene Zeile mit Soll/Ist.

## 3. Mindestbesetzung nach Uhrzeit

- Länder mit Anwesenheitsregel (BW, HB, HE, NI, RP, SH, TH; NW nur als Hinweis): je Viertelstunde des Tages werden die
  laut Vertrag anwesenden Kinder (nach Betreuungsform-Zeiten) und die eingeplanten Kräfte der Gruppe verglichen.
- Regeln je Land vorbelegt (z. B. BW: in der Hauptbetreuungszeit 2 Fachkräfte, in der Randzeit 1; HB: Kinder je Kraft
  „gleichzeitig“; SH: 1 Kraft je 15 Kinder, U3 doppelt, mindestens 2).
- Zu wenig → **Warnung im Dienstplan** am Tag, zusammengefasst je zusammenhängendem Zeitraum: „Bären 7:00–8:00: 1
  Fachkraft, nötig 2“. Nur an Betreuungstagen (keine Wochenenden, Feiertage, Schließtage), nur bei eingetragenen
  Öffnungszeiten.

## 4. Reiter „Personalschlüssel“

- Unter „Kinder“, für Leitung und Träger; Monatsauswahl wie bei der Belegung.
- Je Gruppe eine Zeile: Kinder (davon U3), Soll (Vollzeitkräfte bzw. Stunden), Ist, Differenz; **rot, wenn Ist unter Soll**,
  grün sonst; darunter die Zuschläge und die Fachkraftquote. Letzte Zeile: Einrichtung gesamt.
- Hinweise: „Mitarbeiter ohne Qualifikation: Anna, Berta“, „Kinder ohne Betreuungsform: 2“, „Werte des Landes bitte
  prüfen“ (unsichere Länder), „Stand der Vorgabe: KiTaVO BW, gültig ab …“.
- Druck für Leitung/Träger.

## 5. Einstellungen

- **Einstellungen → Personalschlüssel** (Träger): Vorgabe des Landes mit allen Zahlen, je Zahl änderbar; „Auf Vorgabe
  des Landes zurücksetzen“. Versionen mit „gültig ab“ (mehrere Länder ändern Werte 2026/2027): die App nimmt die zum Monat
  gültige Version.
- **Mitarbeiter** (Leitung/Träger): Qualifikation und Anrechnung in %.
- **Gruppen** (Leitung/Träger): Gruppenart (nur wo nötig).
- **Betreuungsformen**: Tage pro Woche.

## 6. Technik (Überblick)

- Länder-Vorgaben als Daten im Code (`shared/domain/staffing/*`, je Land eine Datei mit Version und Quelle), Änderungen
  des Trägers als Überschreibungen je Einrichtung in der Datenbank.
- Reine Rechenfunktionen je Rechenart + Anwesenheitsprüfung; Services liefern Monats- und Tageswerte.
- Neue Spalten: `employees.qualification`, `employees.staffing_share`; `groups.group_type`; `care_types.days_per_week`;
  Tabelle für die Überschreibungen.

## 7. Tests

- Je Rechenart mit Beispielen aus der Recherche (BW Regelgruppe, BY 1:11 mit U3 2,0, BE nach Alter/Umfang, NW Pauschale).
- Anrechnung, Abwesenheit, Stammgruppe/Dienstgruppe, Einrichtung gesamt.
- Anwesenheitsregel BW (Haupt-/Randzeit) und SH (1:15, U3 doppelt, min. 2) als Warnung mit zusammengefasstem Zeitraum.
- Versionen nach „gültig ab“; Überschreibung durch den Träger; Rücksetzen.

## 8. Nicht enthalten (spätere Schritte)

- Prüfung der Leitungszeit gegen den Plan, Jahresdurchschnitte/Toleranzmonate (BY/ST/HH), Förderberechnung.
- Integrationskinder-Gewichte (Feld am Kind) – vorgesehen, aber erst in einem weiteren Schritt.
