# Zeiterfassung – Design

Stand: 01.10.2026 · Ergänzt die bestehende Spezifikation
[2026-09-30-dienstplan-kindergarten-design.md](2026-09-30-dienstplan-kindergarten-design.md).

## 1. Ziel

Mitarbeitende stempeln ihre Arbeitszeit selbst (Kommen, Gehen, Pausen). Vergessene oder falsche
Stempel trägt nur der Admin nach. Die gestempelte Zeit ersetzt für vergangene Tage die geplante Zeit
im Überstundenkonto; der Admin sieht beim Planen den echten Kontostand und die Vorschau bis
Monatsende.

**Entscheidungen der Leitung (Brainstorming 01.10.2026):**

| Thema | Entscheidung |
|---|---|
| Was zählt fürs Konto | Vergangene Tage: gestempelte Zeit. Heute und Zukunft: Plan als Vorschau. |
| Wo wird gestempelt | Eigenes Handy (eigener Zugang) **und** gemeinsames Kita-Tablet mit PIN. |
| Pausen | Werden gestempelt (aus- und wieder einstempeln). **Kein** automatischer Abzug, auch nicht bei zu kurzer oder fehlender Pause – nur ein Hinweis für den Admin. |
| Sichtbarkeit | Mitarbeitende sehen eigene Stempelzeiten und eigenen Überstundenstand, nicht die anderer. |
| Tablet | Kann stempeln und den allgemeinen Dienstplan (freigegebener Stand, ohne Stunden) zeigen, sonst nichts. |

## 2. Begriffe

- **Stempelzeitraum** (time record): ein Zeitraum eines Tages, `Beginn`–`Ende`, minutengenau.
  Ein Zeitraum ohne Ende ist **offen** (eingestempelt).
- **Ist-Zeit eines Tages** = Summe aller abgeschlossenen Zeiträume des Tages (Lücken = Pausen, zählen nicht).
- **Stichtag „Zeiterfassung ab“**: globale Einstellung. Leer = Zeiterfassung aus (Stempeln nicht
  möglich, alles rechnet wie bisher nach Plan).

## 3. Stempeln

### 3.1 Eigenes Gerät

- Für jeden angemeldeten Benutzer mit verknüpftem Mitarbeiter (auch ein Admin mit Mitarbeiter-Verknüpfung)
  erscheint auf „Mein Dienstplan“ oben die Karte **„Zeiterfassung“**:
  - Großer Knopf **„Einstempeln“** bzw. **„Ausstempeln“** (wenn heute ein offener Zeitraum existiert),
    mit Text „Eingestempelt seit 7:42“.
  - Die Zeiträume von heute, z. B. „7:42–11:40 · 12:10–…“.
  - Die zwei Kontostände (siehe 4.2).
  - Gibt es einen offenen Zeitraum von einem früheren Tag: Hinweis „Am 14.10. nicht ausgestempelt –
    die Leitung trägt die Zeit nach.“
- Beobachter landen nach dem Anmelden auf „Mein Dienstplan“ des aktuellen Monats (bisher: allgemeiner Plan).
- Die Karte erscheint nur, wenn die Zeiterfassung aktiv ist und heute ≥ Stichtag.

### 3.2 Kita-Tablet

- Neue Rolle **`terminal`** („Stempel-Tablet“). Der Admin legt unter „Benutzer“ einen Zugang mit dieser
  Rolle an (ohne Mitarbeiter-Verknüpfung, ohne Pflicht zur Passwortänderung) und meldet das Tablet einmal an.
- Die Sitzung des Tablets soll so lange wie technisch möglich bestehen bleiben; läuft sie ab, meldet
  man das Tablet erneut an.
- Navigation des Tablets: **„Stempeln“** (Startseite) und **„Dienstplan“** (allgemeiner Plan im
  Beobachter-Umfang: nur freigegebener Stand, keine Stunden, keine Hinweise, keine Konten).
  Alle anderen Seiten und APIs sind gesperrt (auch „Mein …“, Druckansicht, Passwort ändern).
- Stempel-Seite:
  - Kacheln mit allen aktuell beschäftigten Mitarbeitenden, die eine PIN haben; grüner Punkt =
    heute eingestempelt.
  - Tippen auf den Namen → PIN-Feld (4 Ziffern, Zahlentastatur auf dem Bildschirm) → Knopf
    „Einstempeln“ oder „Ausstempeln“ (je nach Zustand) → Bestätigung „Eingestempelt 7:42“ →
    nach 5 Sekunden oder Tippen zurück zur Übersicht.
  - Falsche PIN: Meldung, Zähler pro Mitarbeitender. Nach **5** Fehlversuchen ist die Person für
    **15 Minuten** am Tablet gesperrt (gleiche Werte wie beim Login).
- Die PIN setzt/ändert der Admin auf der Mitarbeiter-Seite (Feld „Stempel-PIN“, genau 4 Ziffern;
  „PIN entfernen“ möglich). Gespeichert wird nur ein Hash (wie Passwörter).

### 3.3 Regeln für beide Wege

- Uhrzeit und Datum kommen immer vom **Server**, Zeitzone Europe/Berlin.
- Stempeln geht nur für **jetzt** und nur für **sich selbst** (am Tablet: die Person mit der PIN).
- Einstempeln: Gibt es heute schon einen offenen Zeitraum → Fehler `already_clocked_in`.
  Sonst neuer Zeitraum `heute, Beginn = jetzt, Ende = leer`.
- Ausstempeln: schließt den offenen Zeitraum von **heute** (`Ende = jetzt`). Gibt es keinen →
  Fehler `not_clocked_in`. Offene Zeiträume früherer Tage schließt nur der Admin.
- Ein- und Ausstempeln in derselben Minute ergibt einen Zeitraum mit 0 Minuten (zählt 0).
- Vor dem Stichtag oder bei ausgeschalteter Zeiterfassung: Fehler `time_tracking_off`.

## 4. Konto und Dienstplan

### 4.1 Anrechnung pro Tag

Für jeden Tag `d` einer beschäftigten Person mit Tagessoll `soll(d)` (unverändert):

1. Enthält der Tag einen Code mit Anrechnung „Tagessoll“ (Urlaub, Krank, Fortbildung, Schule,
   Feiertag, Schließtag) → angerechnet = `soll(d)` (wie bisher; Stempel zählen dann nicht).
2. Sonst, wenn Zeiterfassung aktiv **und** `Stichtag ≤ d < heute` → angerechnet = **Ist-Zeit**
   (offene Zeiträume zählen nicht).
3. Sonst → angerechnet = Plan (wie bisher: `workedMinutes` der Einträge).

Wochenenden/Feiertage: Soll 0, Ist-Zeit zählt als Plus (Regel 2 gilt auch dort).

Urlaub, Krank, Fortbildung, Schule, Feiertag und Schließtag werden also **aus dem Dienstplan übernommen**:
dafür wird nicht gestempelt, und an solchen Tagen gibt es keinen Hinweis „Keine Stempelzeit“.

### 4.2 Kontostände

- **„Stand heute“** = Kontostand bis **gestern** (Eröffnungsbuchungen/Korrekturen + Tagesdifferenzen
  nach 4.1).
- **„Voraussichtlich Monatsende“** = Kontostand bis Monatsende (vergangene Tage Ist, heute und
  Zukunft Plan).
- Gilt überall, wo Konten erscheinen: Seitenleiste im Dienstplan, Seite „Stundenkonten“,
  Summenzeilen (Übertrag / Monat / Gesamt), Wochenzeilen (KW), und – nur eigener Stand – „Mein Dienstplan“.
- Hinweis: „Stand heute“ meint bisher „bis einschließlich heute nach Plan“; neu ist es „bis gestern“.
  Ohne aktive Zeiterfassung rechnet „Stand heute“ wie bisher.

### 4.3 Anzeige im Dienstplan (Admin)

- Vergangene Tage ab Stichtag: in der Zelle klein **„Ist h:mm“** (Summe), **orange**, wenn sie
  mehr als 15 Minuten von der geplanten Anrechnung abweicht. Offene Zeiträume: „Ist … (offen)“.
- Klick auf „Ist …“ öffnet die Seite „Zeiterfassung“ für diese Person, diesen Monat und Tag.
- Der Klick auf „Ist …“ wählt die Zelle nicht aus und öffnet kein Zellen-Menü.

### 4.4 „Mein Dienstplan“ (Mitarbeitende)

- Karte „Zeiterfassung“ (3.1) mit „Stand heute“ und „Voraussichtlich Monatsende“.
- In der Tagesliste pro Tag zusätzlich die eigenen Zeiträume und die Ist-Summe; nachgetragene oder
  geänderte Zeiträume tragen den Vermerk „nachgetragen“ bzw. „geändert“.
- Die Stempelzeiten sind live (nicht an die Freigabe des Plans gebunden).

## 5. Nachtragen durch den Admin

### 5.1 Seite „Zeiterfassung“ (`/admin/time`)

- Auswahl Monat (Monatsnavigation) und Mitarbeiter:in.
- Tabelle aller Tage des Monats: Datum · Plan (Kurztext) · Zeiträume · Ist · Differenz zur geplanten
  Anrechnung · Hinweise.
- Pro Tag: Zeitraum **hinzufügen**, **ändern**, **löschen** (Zeitfelder wie im Dienstplan, aber
  **minutengenau**, also ohne 5-Minuten-Raster). Offene Zeiträume können geschlossen werden.
- Regeln: `Ende > Beginn` (beim Bearbeiten durch den Admin ist ein Ende Pflicht), keine
  Überschneidung mit anderen Zeiträumen des Tages, Datum nicht in der Zukunft.
- Oben eine Liste **„Offene Zeiträume“** (alle Personen, frühere Tage) mit Sprung zum Tag.

### 5.2 Protokoll

- Jede Admin-Änderung (anlegen, ändern, löschen) wird mit Zeitpunkt, Admin, Person, Datum und
  „vorher → nachher“ gespeichert.
- Am Zeitraum wird vermerkt, ob er vom Admin angelegt oder geändert wurde (für den Vermerk in 4.4).
- Auf der Seite „Zeiterfassung“ lässt sich das Protokoll eines Tages aufklappen.

### 5.3 Hinweise

Neue Hinweise (nur Admin; in der Seitenleiste des Dienstplans und auf der Seite „Zeiterfassung“),
nur für Tage ab Stichtag und vor heute:

| Hinweis | Bedingung |
|---|---|
| **Ausstempeln vergessen** | offener Zeitraum an diesem Tag |
| **Keine Stempelzeit** | geplante Arbeit (Dienst, Sonderdienst oder Code mit Anrechnung „tatsächliche Zeit“), kein Tagessoll-Code, kein Zeitraum |
| **Pause nicht eingehalten** | Ist > 6 h und Pausen < 30 min, oder Ist > 9 h und Pausen < 45 min. Pausen = Lücken zwischen Zeiträumen des Tages, nur Lücken ≥ 15 min zählen. Kein Abzug. |
| **Gestempelt ohne Dienst** | Zeiträume vorhanden, aber an dem Tag kein Eintrag im Plan |

## 6. Einstellungen und Stammdaten

- Einstellungen: neues Feld **„Zeiterfassung ab“** (Datum; leer = aus).
- Mitarbeiter-Seite: **„Stempel-PIN“** setzen/ändern/entfernen.
- Benutzer-Seite: Rolle **„Stempel-Tablet“** wählbar (ohne Mitarbeiter-Verknüpfung).

## 7. Technische Umsetzung (Überblick)

### 7.1 Datenmodell (neue Migration)

- `time_records`: `id`, `employee_id` (FK, cascade), `date` (ISO), `start` (Minuten), `end` (Minuten, null = offen),
  `source` (`self` | `terminal` | `admin`), `edited_by` (FK users, null), `edited_at` (ISO, null),
  `created_at`. Index auf (`employee_id`, `date`).
- `time_record_changes`: `id`, `employee_id`, `date`, `record_id` (null nach Löschen), `before` (Text),
  `after` (Text), `actor_id` (FK users), `at` (ISO).
- `app_settings`: `key` (PK), `value` (Text). Erster Schlüssel: `time_tracking_from`.
- `employees`: neue Spalten `pin_hash` (null), `pin_failed` (int, 0), `pin_locked_until` (ISO, null).
- `users.role`: Enum erweitert um `terminal`.

### 7.2 Domänenlogik (`shared/domain`, rein, getestet)

- `timeRecords.ts`: `recordedMinutes(records)`, `breakGaps(records)`, `breakRuleViolated(records)`,
  `nowInBerlin(now): { date, minutes }`.
- `balance.ts`: Anrechnung nach 4.1 über eine Option `{ trackingFrom, today, recordsByDate }` in
  `computeDay` / `computeRange` / `balanceUntil`; ohne Option bleibt alles wie bisher.
- `warnings.ts`: neue Warning-Typen `open_record`, `missing_record`, `break_rule`, `record_without_plan`.

### 7.3 Server

- Services: `timeTracking.ts` (stempeln, Admin-CRUD, Protokoll, Monatsabfrage), `terminal.ts`
  (Status-Liste, PIN prüfen + Sperre, stempeln), `appSettings.ts`; `balances.ts` / `plan.ts` erweitert.
- Rechte: neue Guard `requireTerminal(event)`; `requireUser` lehnt die Rolle `terminal` ab, außer für
  den allgemeinen Plan (`GET /api/plan/:year/:month`) im Beobachter-Umfang. Der Rechte-Test bekommt
  eine dritte Liste für Tablet-Routen.
- APIs:
  - `GET /api/my/time?year&month`, `POST /api/my/time/stamp` (`{ action: 'in' | 'out' }`) – angemeldete Person.
  - `GET /api/terminal/status`, `POST /api/terminal/stamp` (`{ employeeId, pin, action }`) – nur Tablet.
  - `GET/POST /api/time-records`, `PUT/DELETE /api/time-records/:id`, `GET /api/time-records/open` – nur Admin.
  - `PUT /api/employees/:id/pin`, `DELETE /api/employees/:id/pin` – nur Admin.
  - `GET/PUT /api/app-settings` – nur Admin.

### 7.4 Oberfläche

- Neue Seiten: `/terminal` (Tablet), `/admin/time` (Zeiterfassung).
- Erweitert: „Mein Dienstplan“ (Karte + Ist pro Tag), Dienstplan-Zellen („Ist …“), Seitenleiste
  (neue Hinweise, zwei Stände), Stundenkonten, Mitarbeiter-Seite (PIN), Benutzer-Seite (Rolle),
  Einstellungen (Stichtag), Navigation und Start-Weiterleitung je Rolle.
- `TimeInput` bekommt eine Option für minutengenaue Eingabe (ohne 5-Minuten-Raster).

## 8. Fehlerfälle

| Code | Text (Deutsch, sinngemäß) |
|---|---|
| `time_tracking_off` | Die Zeiterfassung ist noch nicht aktiv. |
| `already_clocked_in` | Du bist bereits eingestempelt. |
| `not_clocked_in` | Du bist nicht eingestempelt. |
| `pin_invalid` | PIN falsch. |
| `pin_locked` | Zu viele Fehlversuche – bitte in 15 Minuten erneut versuchen. |
| `pin_missing` | Für diese Person ist keine PIN hinterlegt. |
| `record_overlap` | Der Zeitraum überschneidet sich mit einem anderen Zeitraum des Tages. |
| `record_in_future` | Zeiten in der Zukunft können nicht eingetragen werden. |
| `no_employee` | Dein Zugang ist mit keiner Mitarbeiterin verknüpft. |

## 9. Tests

- Domäne: Anrechnung (vor/nach Stichtag, heute/Zukunft = Plan, Tagessoll-Codes, Wochenende mit Ist,
  offene Zeiträume zählen nicht), Kontostände „bis gestern“ und „Monatsende“, Pausenregel
  (6 h/9 h-Grenzen, Lücken < 15 min), Berlin-Zeit inkl. Sommer-/Winterzeitwechsel.
- Services: Ein-/Ausstempeln inkl. Fehlerfälle, Tablet-PIN inkl. Sperre nach 5 Fehlversuchen und
  Ablauf nach 15 min, Admin-CRUD inkl. Überschneidung/Zukunft und Protokoll, Hinweise.
- Rechte: Tablet kommt nur an Stempel-APIs und den allgemeinen Plan; Beobachter nur an eigene Zeiten;
  Admin-APIs nur Admin.
- Browser: Stempeln am Handy-Zugang, Tablet mit PIN, Nachtragen, Anzeige im Plan – in einem leeren
  Testmonat bzw. mit Testpersonen, danach aufräumen.

## 10. Nicht enthalten

- Kein automatischer Pausenabzug, keine Rundung.
- Kein Stempeln mit Ortung, NFC oder Chipkarte.
- Keine Selbstkorrektur durch Mitarbeitende und keine Korrektur-Anträge.
- Keine Export-/Lohnschnittstelle.
