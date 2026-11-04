# Teamsitzungsprotokolle unterzeichnen

Stand: 04.11.2026 · Baut auf die Teamsitzungen auf (`server/services/teamMeetings.ts`, Seiten `app/pages/team-meetings/`,
Ausdruck `app/pages/print/team-meetings/[id].vue`) und auf die PIN am Kita-Tablet (`verifyEmployeePin` in
`server/services/terminal.ts`, Sperre nach Fehlversuchen wie beim Stempeln).

## 1. Ziel

Jede Person, die an einer Teamsitzung teilgenommen hat, bestätigt mit einem Klick, das freigegebene Protokoll gelesen zu
haben („unterzeichnet“). Am Protokoll, in der Liste und auf dem Ausdruck sieht man, wer unterzeichnet hat und wer noch fehlt.

| Entschieden | |
|---|---|
| Art | Bestätigen per Knopf mit dem eigenen Zugang oder am Kita-Tablet mit Name und PIN; keine gezeichnete Unterschrift |
| Wer | alle ausgewählten Teilnehmer (Mitarbeiter der Einrichtung); Gäste unterzeichnen nicht |
| Wann | erst nach der Freigabe durch die Leitung |
| Wieder geöffnet | alle Unterzeichnungen verfallen; nach der neuen Freigabe unterzeichnen alle neu |
| Für andere | niemand unterzeichnet für eine andere Person, auch die Leitung nicht |

## 2. Teilnehmer

- Beim Anlegen und Bearbeiten (nur im Entwurf) wählt man die Teilnehmer per Häkchen aus den Mitarbeitern der Einrichtung
  (nicht ausgeschiedene, nach der Reihenfolge der Mitarbeiter-Liste). Wer schon ausgewählt ist, bleibt auswählbar, auch wenn
  die Person inzwischen ausgeschieden ist. Wer die Teamsitzungen schreibt, darf die Teilnehmer ändern (wie die übrigen
  Kopfdaten).
- Das bisherige Freitextfeld „Teilnehmer“ heißt künftig **„Gäste“** (z. B. „Frau Weber, Fachberatung“), höchstens 300 Zeichen
  wie bisher. Gäste unterzeichnen nicht.
- Bestehende Sitzungen: der bisherige Text bleibt als „Gäste“ stehen; sie haben keine ausgewählten Teilnehmer und brauchen
  keine Unterzeichnung (keine Datenumwandlung von Namen in Personen).
- Gespeichert wird je Teilnehmer der Name zum Zeitpunkt der Auswahl, damit das Protokoll lesbar bleibt, wenn die Person
  später endgültig gelöscht wird (dann bleibt der Name als Text, wie bei „freigegeben von …“).
- Die Mitarbeiter-Liste zum Auswählen braucht keine zusätzlichen Rechte: Name und Kürzel der Mitarbeiter der eigenen
  Einrichtung, für jede Person, die Teamsitzungen schreiben darf, und für das Kita-Tablet.

## 3. Unterzeichnen

- Möglich, wenn die Sitzung **freigegeben** ist, die Person Teilnehmer ist, noch nicht unterzeichnet hat und nicht
  ausgeschieden ist (Ausscheidedatum vor heute).
- **Mit eigenem Zugang:** Im Protokoll steht für die angemeldete Person der Knopf **„Gelesen und unterzeichnen“** (mit
  Rückfrage). Das Konto muss mit dem Mitarbeiter verknüpft sein. Jede Rolle, die Teamsitzungen öffnen darf (Mitarbeiter,
  Gruppenleitung, Leitung, Träger mit verknüpftem Mitarbeiter), unterzeichnet so für sich selbst.
- **Am Kita-Tablet:** Knopf **„Unterzeichnen“** im Protokoll; dann wählt man seinen Namen aus den Teilnehmern, die noch
  offen sind, und gibt die eigene PIN ein. Fehlversuche zählen zur selben Sperre wie beim Stempeln und Aufschließen der
  Kinder. Ohne PIN gibt es die Meldung, dass die Leitung zuerst eine PIN vergeben muss.
- Gespeichert werden Zeitpunkt und Weg („Zugang“ oder „Tablet“). Zweimal unterzeichnen geht nicht (Meldung „schon
  unterzeichnet“).
- Fehler: nicht freigegeben → „Erst nach der Freigabe“; keine Teilnehmerin/kein Teilnehmer → „Nur Teilnehmer
  unterzeichnen“; ausgeschieden → wie bisher `employee_inactive`.

## 4. Wieder öffnen

Beim Wieder-Öffnen werden alle Unterzeichnungen der Sitzung gelöscht (Zeitpunkt und Weg leer). Die Teilnehmer bleiben.
Bei jeder wieder geöffneten Sitzung mit Teilnehmern steht am Protokoll neben dem bisherigen Hinweis „zuletzt wieder
geöffnet am …“ zusätzlich: „Unterzeichnungen von vorher sind verfallen; nach der neuen Freigabe unterzeichnen alle neu.“
Die Rückfrage beim Wieder-Öffnen nennt das ebenfalls, wenn schon jemand unterzeichnet hat.

## 5. Anzeige

- **Protokoll-Seite:** Abschnitt **„Unterzeichnet“** mit allen Teilnehmern: „✓ Name – 04.11.2026, 14:20“ oder „noch offen“
  (im Entwurf: „Unterzeichnen nach der Freigabe“). Darunter „4 von 6 unterzeichnet“.
- **Liste der Teamsitzungen:** je freigegebener Sitzung mit Teilnehmern „4 von 6 unterzeichnet“ (alle unterzeichnet: grün);
  ist die angemeldete Person selbst noch offen, steht bei der Sitzung „Du hast noch nicht unterzeichnet“. Oben auf der
  Seite ein Hinweis „Du musst noch N Protokolle unterzeichnen“ (alle Jahre, nicht nur das gewählte), mit Sprung zur ersten.
  Am Tablet gibt es diesen persönlichen Hinweis nicht.
- **Ausdruck:** unter dem Protokoll statt der Freigabe-Zeile allein zusätzlich die Liste „Unterzeichnet: Name – Datum, Uhrzeit“
  und „noch nicht unterzeichnet: …“. Gäste stehen im Kopf unter „Gäste“.

## 6. Daten

- Neue Tabelle `team_meeting_participants`: `meeting_id` (→ team_meetings, beim Löschen der Sitzung mit gelöscht),
  `employee_id` (→ employees, beim endgültigen Löschen der Person auf leer), `name` (Text), `sort_order`, `signed_at`
  (ISO-Zeit oder leer), `signed_via` (`account` | `tablet` | leer). Eindeutig je Sitzung und Person.
- Die Spalte `team_meetings.participants` bleibt und ist künftig das Feld „Gäste“.
- Die Löschfristen ändern sich nicht: Teamsitzungen bleiben beim Ausscheiden einer Person erhalten (wie bisher), der
  Teilnehmer-Eintrag behält den Namen.

## 7. Tests

- Service: Teilnehmer speichern (nur Mitarbeiter der Einrichtung, nur im Entwurf, Reihenfolge, Name), unterzeichnen mit
  Zugang und am Tablet (PIN richtig/falsch/Sperre/keine PIN), alle Fehlerfälle aus §3, Wieder-Öffnen löscht Unterzeichnungen,
  endgültiges Löschen einer Person lässt den Namen stehen, Zähler in der Liste, „noch offen“ für die angemeldete Person.
- Rechte: neue Routen im Routen-Verzeichnis (`tests/fixtures/route-access-before.json`), Tablet nur für die eigene
  Einrichtung.
- Browser: Anlegen mit Teilnehmern, Freigeben, Unterzeichnen als Mitarbeiterin, Ausdruck.
