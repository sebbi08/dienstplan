# Rechte und Rollen, Teil 2: Seite „Rechte und Rollen“

Stand: 28.10.2026 · Baut auf `2026-10-27-rechte-und-rollen-design.md` (§5) und Teil 1 auf (Katalog
`shared/domain/permissions.ts`, `requirePermission`, `useCan`). Offene Punkte aus Teil 1:
`docs/superpowers/plans/2026-10-28-rechte-teil2-notizen.md` (gehören in diesen Teil).

## 1. Ziel

Der Träger stellt ein, was Leitung und Mitarbeiter dürfen – je Rolle und als Ausnahme je Person. Auf der Seite stehen
keine 65 Einzelrechte, sondern **gebündelte Schalter**.

## 2. Schalter (Bündel)

Jeder Schalter steht für feste Einzelrechte des Katalogs. „Umfang“: bei Kinder-Schaltern „nur eigene Gruppe“ oder
„ganze Einrichtung“.

| Bereich | Schalter | Einzelrechte |
|---|---|---|
| Dienstplan | ansehen | plan.view |
| | bearbeiten (inkl. Personalschlüssel ansehen) | plan.edit, plan.staffing |
| | freigeben | plan.release |
| Urlaub | beantragen | leave.request |
| | planen und genehmigen | leave.plan |
| Zeiten | eigene Zeiten und Stempeln | time.own |
| | alle Zeiten und Stundenkonten verwalten | time.manage |
| Mitarbeiter | ansehen (inkl. Urlaubsübersicht aller) | employees.view, leave.overview |
| | pflegen (inkl. Krankheitstage) | employees.edit, employees.sickness |
| | Vertragsangaben ansehen | employees.contractView |
| | Vertragsangaben bearbeiten | employees.contractEdit |
| | ausgeschiedene endgültig löschen | employees.delete |
| | Mitarbeitergespräche führen | talks.manage |
| Personalakte | Anschrift und Kontakt | employees.personal |
| | Lohn, Steuer und sensible Daten | employees.payroll, employees.sensitive |
| | Dokumente Qualifikationen | employees.docs.qualifications |
| | alle übrigen Dokumente | employees.docs.contract, .application, .correspondence, .measures, .salary |
| Kinder (Umfang) | ansehen | children.view |
| | Anwesenheit und Gruppenbuch | children.attendance |
| | eintragen und Akten ändern | children.edit |
| | verwalten (Abmelden, Belegung, Archiv, Vormerkungen) | children.manage, children.planned |
| | auch mit eigenem Zugang (nicht nur am Tablet) | children.ownAccount |
| | Schulkinder-Einstellungen | children.schoolSettings |
| Bögen | ausfüllen | childForms.edit |
| | verwalten (Vorlagen, Freigaben) | childForms.manage, formTemplates.manage |
| Teamsitzungen | mitschreiben | teamMeetings.write |
| | freigeben | teamMeetings.manage |
| Kasse | ansehen und führen | cash.view, cash.book |
| | Monate abschließen | cash.close |
| | abgeschlossene Monate wieder öffnen | cash.reopen |
| Kalender | ansehen | calendar.own |
| | Termine und Schließzeiten bearbeiten | calendar.edit, closures.manage |
| Vorlagen | ansehen | printTemplates.view |
| | bearbeiten | printTemplates.edit |
| Verwaltung | Einstellungen der Einrichtung | settings.facility |
| | Personalschlüssel-Werte ändern | settings.staffing |
| | Zugänge verwalten | users.manage |

- Gegenüber dem Gespräch aufgeteilt, damit die heutigen Grundeinstellungen exakt erhalten bleiben: „Kasse abschließen“ /
  „wieder öffnen“ (die Leitung darf heute nur abschließen), „Urlaubsübersicht“ wandert zu „Mitarbeiter ansehen“ (die
  Leitung sieht sie heute auch ohne Urlaubsplanung), „Personalschlüssel-Werte ändern“ und „Schulkinder-Einstellungen“
  eigene Schalter (heute nur Träger).
- Ausgegraut mit „nur Träger“: die festen Träger-Rechte (Rechte einstellen, Träger-Zugänge, Einrichtungen, Löschen nach
  Fristen, Datensicherung, „Einstellungen für“, Codes, Gruppen anlegen, Mitarbeiter/Kinder verschieben, Druckvorlagen für
  alle Einrichtungen, Urlaubs-Grundeinstellungen).
- Eigene Daten (eigener Dienstplan, eigene Gespräche, Passwort) hat jede Person mit Zugang; kein Schalter.

## 3. Seite „Rechte und Rollen“ (Mehr → Benutzer, nur Träger)

- Tabelle: Zeilen = Schalter nach Bereich, Spalten = **Leitung**, **Mitarbeiter** (Teil 3 ergänzt **Gruppenleitung**).
  Häkchen je Zelle; bei Kinder-Schaltern zusätzlich Umfang.
- Abhängigkeiten sichtbar: „braucht: …“ neben dem Schalter; Setzen zieht Voraussetzungen mit (Hinweis), Wegnehmen fragt
  „Dann entfällt auch: …“; eingeschlossene Schalter grau „enthalten in: …“.
- „Auf Grundeinstellung zurücksetzen“ je Rolle (Rückfrage). Grundeinstellung = heutige Rechte (Teil 1).
- Die bisherige Übersicht „Rechte der Rollen“ zeigt künftig die tatsächlichen Einstellungen.

## 4. Ausnahmen je Person (Seite der Person → Zugang, nur Träger)

- Liste der Schalter mit Zustand „von der Rolle“ / „zusätzlich erlaubt“ / „weggenommen“; Ausnahme setzen oder entfernen.
- Übernahme der heutigen Einzelfreigaben als Ausnahmen: „darf Kinderakten pflegen“ → „eintragen und Akten ändern“
  (wirkt wie heute nur am Tablet, solange „auch mit eigenem Zugang“ fehlt); Zuständige der Urlaubsplanung (Leitung) →
  „planen und genehmigen“; Schalter „Vertragsangaben für die Leitung sichtbar“ → Rollen-Einstellung der Leitung.
  Die alten Schalter verschwinden aus Benutzer-Seite und Einstellungen und verweisen auf die Rechte-Seite; die Liste
  „Zuständig für die Urlaubsplanung“ bleibt nur für die Benachrichtigung des Trägers.
- Nur der Träger setzt Ausnahmen (heute darf die Leitung „darf Kinderakten pflegen“ setzen – das entfällt).

## 5. Technik (Überblick)

- Speicher: Rollen-Einstellungen je Schalter (Rolle, Schalter, an/aus, Umfang); Ausnahmen je Konto (Schalter, erlauben/
  wegnehmen, Umfang). Fehlt eine Zeile, gilt die Grundeinstellung. Unbekannte Schalter aus der Datenbank werden
  ignoriert.
- `effectivePermissions` liest Rolle + Ausnahmen; Ergebnis wie bisher pro Anfrage neu (Änderungen wirken sofort, im
  Menü nach dem nächsten Laden).
- Alle Stellen aus den Teil-1-Notizen, die noch die Rolle statt der Rechte der Person nutzen, werden umgestellt.
- Test: Bündel-Abbildung so, dass die Grundeinstellung genau die Teil-1-Rechte ergibt (für Leitung und Mitarbeiter);
  die Route-Matrix bleibt mit Grundeinstellung grün.

## 6. Tests

- Grundeinstellung = Teil-1-Rechte; Rollen-Änderung wirkt auf alle der Rolle; Ausnahme erlauben/wegnehmen; Umfang;
  Abhängigkeiten (Setzen zieht mit, Wegnehmen nimmt Abhängige); feste Träger-Rechte nicht vergebbar (Server 400/403).
- Übernahme der alten Freigaben (Migration) ergibt dieselben wirksamen Rechte wie vorher.

## 7. Nicht enthalten

- Rolle Gruppenleitung (Teil 3), Rechte je Einrichtung, eigene Rollen, Protokoll der Rechte-Änderungen.
