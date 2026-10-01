# Dienstplan Kindergarten – Design-Spezifikation

Stand: 30.09.2026 · Status: zur Prüfung

## 1. Ziel

Eine Web-App, mit der die Kita-Leitung (Administrator) den monatlichen Dienstplan aller
Mitarbeiter erstellt, Pflichtbesetzungen und Stundenkonten im Blick behält und den Plan
für die Mitarbeiter (Beobachter) freigibt. Die App läuft als Docker-Container auf einem
eigenen Server.

**Erfolgskriterien**

- Ein Monatsplan lässt sich schneller per Button erstellen als bisher (z. B. in Excel).
- Die App warnt zuverlässig bei fehlenden Einträgen und fehlenden Pflichtdiensten.
- Plus-/Minusstunden und Urlaubskonten stimmen und sind für den Admin jederzeit sichtbar.
- Beobachter sehen nur, was sie sehen dürfen – auch serverseitig abgesichert.

**Sprache:** Oberfläche komplett Deutsch; Code, Bezeichner, Kommentare, Commits komplett Englisch.

## 2. Rollen und Rechte

| | Administrator | Beobachter |
|---|---|---|
| Monatsplan ansehen | Entwurf (aktueller Stand) aller Monate | nur den zuletzt freigegebenen Stand |
| „Mein Dienstplan“ (nur eigene Dienste) | – | ja (zuletzt freigegebener Stand) |
| Einträge bearbeiten, Info-Spalten | ja | nein |
| Freigeben / erneut freigeben | ja | nein |
| Tagesübersicht | ja | ja (freigegebene Monate) |
| Änderungsmarkierungen | ja | ja |
| Warnungen | ja | nein |
| Wochenarbeitszeit, Soll/Ist, Stundenkonto | ja | nein |
| Urlaubskonto | alle Mitarbeiter | nur das eigene |
| Mitarbeiter, Benutzer, Schließzeiten, Einstellungen | ja | nein |
| Eigenes Passwort ändern | ja | ja |

- Jeder Beobachter hat ein **eigenes Konto**, verknüpft mit genau einem Mitarbeiter.
- Es kann mehrere Administratoren geben. Ein Admin-Konto kann optional mit einem Mitarbeiter verknüpft sein.
- Alle Rechte werden **serverseitig in jeder API-Route** geprüft. Die Oberfläche blendet
  zusätzlich aus, ist aber nicht die Sicherung.

## 3. Fachliche Regeln

### 3.1 Einträge

Eine Zelle (Mitarbeiter × Tag) kann **mehrere Einträge** enthalten (z. B. „VZ 7:30–9:30“ + „Dienst 9:30–15:45“).
Ein Eintrag ist eines von:

- **Dienst aus Vorlage** (Button). Vorbelegte Vorlagen, vom Admin änderbar:

  | Kürzel | Name | Zeit | Pause |
  |---|---|---|---|
  | F1 | Frühdienst | 7:00–13:15 | – |
  | F2 | Frühdienst 2 | 7:30–15:45 | 11:40–12:10 |
  | M | Mitteldienst | 7:45–16:00 | 11:40–12:10 |
  | S | Spätdienst | 8:45–17:00 | 12:10–12:40 |
  | HK | Haushaltskraft | 11:00–16:00 | – |

  In Zellen und auf Buttons steht standardmäßig die Uhrzeit; das Kürzel wird als Tooltip
  und in der Legende der Druckansicht angezeigt.
- **Sonderdienst** (manuell): Von, Bis, optional Pause von/bis, optional Notiz.
- **Code**: Urlaub, Krank, Fortbildung, Schule, sonstiges, VZ, Büro, Feiertag, Schließtag.
  Jeder Code hat Farbe, Anrechnungsmodus und die Angabe, ob Uhrzeiten nötig sind.

Standard der Codes (vom Admin änderbar):

| Code | Farbe | Anrechnung | Uhrzeiten |
|---|---|---|---|
| Urlaub | grau | Tagessoll | nein |
| Krank | grau | Tagessoll | nein |
| Fortbildung | grau | Tagessoll | nein |
| Schule | grau | Tagessoll | nein |
| sonstiges | neutral | keine (bzw. Zeit, wenn Uhrzeiten eingetragen) | optional |
| VZ | grün | tatsächliche Zeit | ja |
| Büro | gelb | tatsächliche Zeit | ja |
| Feiertag | blau | Tagessoll | nein |
| Schließtag | blau | Tagessoll | nein |

Validierung: Ende > Beginn; Pause liegt innerhalb der Arbeitszeit; Zeiten im 5-Minuten-Raster.

### 3.2 Arbeitszeit

- Alle Zeiten werden intern als **Minuten seit Mitternacht** (Integer) gerechnet; Anzeige als `h:mm`.
- **Netto-Zeit eines Eintrags** = Ende − Beginn − Pausendauer.
  Beispiel: 7:45–16:00, Pause 11:40–12:10 → 8:15 − 0:30 = 7:45 h.
- **Tagessoll** = an diesem Tag gültige Wochenstunden ÷ 5, nur Mo–Fr.
  Sa/So, gesetzliche Feiertage: Tagessoll 0.
- **Angerechnete Zeit pro Tag:**
  - Enthält der Tag einen Code mit Anrechnung „Tagessoll“ → angerechnet = Tagessoll
    (andere Einträge des Tages zählen dann für das Konto nicht; Beispiel: nach 3 h krank nach Hause).
  - Sonst → Summe der Netto-Zeiten aller zeitbehafteten Einträge (Dienste, Sonderdienste, VZ, Büro, sonstiges mit Zeit).
  - An Feiertagen/Wochenenden (Soll 0) zählt jede eingetragene Arbeitszeit als Plus (z. B. Sommerfest).
- **Tagesdifferenz** = angerechnet − Tagessoll.
- Ein Mitarbeiter wird ab dem ersten `gültig ab`-Datum seiner Wochenstunden berechnet und
  bis einschließlich `ausgeschieden am` (falls gesetzt).

### 3.3 Wochen- und Stundenkonto (nur Admin)

- **Wochenzeile** nach jeder Kalenderwoche (Mo–So) im Monatsplan: pro Mitarbeiter Soll, Ist, Differenz
  (grün Plus, rot Minus). Wochen über den Monatswechsel werden vollständig gerechnet.
- **Stundenkonto** = Summe aller Tagesdifferenzen + Startsaldo + Korrekturbuchungen.
  - Startsaldo und Korrekturen sind Buchungen mit Datum, ± Minuten und Grund
    (z. B. „Übertrag“, „Auszahlung“).
  - Angezeigt werden **„Stand heute“** (Tage bis einschließlich heute) und
    **„Stand Monatsende“** (inkl. geplanter Einträge des angezeigten Monats).
- Wochenstunden haben eine **Historie mit `gültig ab`**; jeder Tag wird mit dem an diesem
  Tag gültigen Wert gerechnet.

### 3.4 Urlaubskonto

- Pro Mitarbeiter und Jahr: **Anspruch** (Tage) und **Übertrag aus Vorjahr** (Tage), manuell vom Admin gepflegt.
- Gezählt wird 1 Tag je Urlaubs-Eintrag an Mo–Fr, außer gesetzlichen Feiertagen.
- **genommen** = Urlaubstage vor heute · **verplant** = Urlaubstage ab heute ·
  **frei verfügbar** = Anspruch + Übertrag − genommen − verplant.
- Beobachter sehen unter „Mein Urlaub“ diese Werte und eine Liste ihrer Urlaubstage
  (zusammengefasst zu Zeiträumen).

### 3.5 Feiertage und Schließzeiten

- **Gesetzliche Feiertage Baden-Württemberg** werden berechnet (nicht gespeichert):
  Neujahr, Hl. Drei Könige, Karfreitag, Ostermontag, 1. Mai, Christi Himmelfahrt,
  Pfingstmontag, Fronleichnam, Tag der Deutschen Einheit, Allerheiligen, 1. und 2. Weihnachtstag.
  Bewegliche Feiertage über die Osterformel.
  Sie gelten automatisch für alle: Datumszeile blau, Tagessoll 0, keine Warnungen.
- **Schließzeiten**: Zeitraum (von–bis), Bezeichnung, Modus **Urlaub** oder **Schließtag**.
  - Beim Anlegen schreibt die App für alle aktiven Mitarbeiter an Mo–Fr (ohne Feiertage)
    einen Eintrag mit dem gewählten Code. Die Einträge sind mit der Schließzeit verknüpft.
  - Der Admin kann einzelne Einträge überschreiben (z. B. Putztag).
  - Beim Löschen einer Schließzeit werden nur die noch unveränderten verknüpften Einträge entfernt.
  - Einzelne freie Tage (Brückentag, pädagogischer Tag) = Schließzeit von einem Tag im Modus Schließtag.

### 3.6 Warnungen (nur Admin)

Geprüft wird an Mo–Fr, die weder gesetzlicher Feiertag noch Teil einer Schließzeit sind.

1. **Kein Eintrag**: aktiver Mitarbeiter ohne jeden Eintrag an diesem Tag.
2. **Pflichtdienst fehlt**: Pflichtregeln (vom Admin änderbar), Standard:
   - mindestens 2 Dienste mit Beginn 8:45 **und** Ende 17:00
   - mindestens 1 Dienst mit Beginn 7:00
   - mindestens 1 Dienst mit Beginn 7:30

   Gezählt werden nur Dienste aus Vorlagen und Sonderdienste (keine Codes, auch nicht VZ/Büro).
   Meldung z. B. „Nur 1× 8:45–17:00 (2 benötigt)“.
3. **Tagessoll nicht erreicht**: Tag mit VZ oder Büro, dessen angerechnete Zeit unter dem Tagessoll liegt.
   Anzeige in der Zelle: „noch 5:48 h“; beim Anklicken werden passende Ergänzungen angeboten.
   (Das Ergänzen macht der Admin manuell.)

Darstellung: Warnsymbol in Zelle bzw. Warnspalte der Datumszeile, Tooltip mit Text,
sowie gesammelte Warnungsliste in der Seitenleiste.

### 3.7 Freigabe und Änderungsmarkierung

*(Überarbeitet am 01.10.2026: Schnappschuss-Modell statt Live-Sicht für Beobachter.)*

- Der Admin bearbeitet immer den **Entwurf** (aktueller Stand). Ein Monat ohne Freigabe ist für
  Beobachter nicht sichtbar (Hinweis „Dieser Monat ist noch nicht freigegeben“).
- **Freigeben / erneut freigeben** speichert einen **Schnappschuss** des Monats: Mitarbeiterspalten,
  alle Einträge, Info-Spalten und Schließzeit-Bezeichnungen zu diesem Zeitpunkt, mit Zeitpunkt und
  freigebender Person. Jede Freigabe erzeugt einen neuen Schnappschuss; alle bleiben erhalten.
- **Beobachter sehen ausschließlich den neuesten Schnappschuss**: allgemeiner Dienstplan,
  „Mein Dienstplan“, Tagesübersicht und Druckansicht. Änderungen im Entwurf werden für sie erst mit
  der nächsten Freigabe sichtbar.
- **Freigegebene Änderungen (durchgezogener oranger Rahmen):** Eine Zelle (bzw. Info-Feld) ist
  markiert, wenn sich ihr Inhalt zwischen zwei aufeinanderfolgenden Schnappschüssen geändert hat –
  über **alle** Freigaben seit der ersten. Die Markierung bleibt dauerhaft. Tooltip: die ganze
  Geschichte, je Freigabe eine Zeile, z. B. „Freigabe 12.10.2026 08:15 (admin): Krank → 8:45–17:00“.
  Verglichen wird der detaillierte Zellinhalt (Dienstkürzel, Zeiten, Pause, Notiz).
- **Noch nicht freigegebene Änderungen (gestrichelter oranger Rahmen, nur Admin):** Zellen bzw.
  Info-Felder, deren Entwurf vom neuesten Schnappschuss abweicht. Tooltip:
  „Noch nicht freigegeben: vorher → jetzt“.
- Kopfzeile (Admin): „Freigegeben am … von … · X freigegebene Änderungen · Y noch nicht freigegeben“.
  Kopfzeile (Beobachter): „Freigegeben am … von … · X Änderungen“.
- „Freigabe zurückziehen“ entfällt: ein einmal freigegebener Monat bleibt für Beobachter sichtbar.
- **„Mein Urlaub“** rechnet weiterhin mit dem aktuellen Stand (auch aus nicht freigegebenen Monaten).
- Das bisherige Änderungsprotokoll (`change_log`) bleibt als internes Protokoll bestehen, wird aber
  nicht mehr für Markierungen verwendet.
- Bereits freigegebene Monate ohne Schnappschuss erhalten beim Serverstart einmalig einen
  Schnappschuss aus dem aktuellen Stand (ohne Markierungen).

### 3.8 Tagesübersicht

- Für einen gewählten Tag: pro Person ein Zeitbalken im **15-Minuten-Raster**,
  Bereich standardmäßig 7:00–17:00, automatisch erweitert, wenn Einträge außerhalb liegen.
- Farben: Arbeitszeit neutral (z. B. violett/türkis), **Pause rot**, Urlaub/Krank/Fortbildung/Schule **grau**,
  VZ **grün**, Büro **gelb**, Feiertag/Schließtag **blau**.
- Zeile **„Anwesend“**: Anzahl anwesender Betreuungskräfte pro 15-Minuten-Abschnitt
  (Arbeitszeit inkl. VZ und Büro, ohne Pausen, ohne Abwesenheitscodes).
- Dienstvorlagen haben das Merkmal **„zählt als Betreuungskraft“** (Standard: ja; HK: nein).
  Dienste ohne dieses Merkmal erscheinen als eigener Balken in eigener Farbe, zählen aber
  nicht zu „Anwesend“. Für Stundenkonto und Warnung „Kein Eintrag“ zählen sie normal.

## 4. Bildschirme

| Seite | Rolle | Inhalt |
|---|---|---|
| Anmeldung | alle | Benutzername, Passwort |
| Monatsplan | alle | Kopf „Monat Jahr“ mit Blättern, Freigabestatus; Tabelle Datum · Mitarbeiter · Info 1 · Info 2 · Warnung; Wochenzeilen (Admin); Button-Leiste (Admin); Seitenleiste Warnungen/Stundenkonten (Admin); Tagesübersicht bei Klick aufs Datum |
| Mein Dienstplan | Beobachter | eigene Einträge des Monats als Liste, Änderungsmarkierung |
| Mein Urlaub | Beobachter | Anspruch, Übertrag, genommen, verplant, frei; Liste |
| Mitarbeiter | Admin | anlegen, Reihenfolge, ausgeschieden am; Wochenstunden-Historie; Urlaubsanspruch/Übertrag je Jahr; Korrekturbuchungen |
| Stundenkonten | Admin | alle Mitarbeiter: Saldo heute / Monatsende |
| Urlaub | Admin | alle Urlaubskonten eines Jahres |
| Schließzeiten | Admin | Liste, anlegen, löschen |
| Einstellungen | Admin | Dienstvorlagen, Codes (Farbe, Anrechnung), Pflichtregeln, Datenbank-Backup herunterladen |
| Benutzer | Admin | anlegen, Rolle, Mitarbeiter-Verknüpfung, Passwort zurücksetzen, deaktivieren |
| Passwort ändern | alle | eigenes Passwort |
| Druckansicht | alle | Monatsplan im Querformat mit Farben; ohne Stundenzeilen für Beobachter |

**Bedienung im Monatsplan (Admin):** Zelle anklicken → Button wählen; Umschalt-Klick markiert
mehrere Zellen (z. B. eine Urlaubswoche). „Sonderdienst…“ öffnet ein Formular.
„+ hinzufügen“ legt einen weiteren Eintrag in derselben Zelle an. Einträge lassen sich einzeln löschen.
Info-Spalten werden direkt in der Zelle bearbeitet.

**Geräte:** optimiert für PC und Tablet; auf dem Handy lesbar (horizontal scrollbare Tabelle).

## 5. Technische Architektur

- **Nuxt 4** (Vue 3, TypeScript), **Nuxt UI** + Tailwind für die Oberfläche.
- **Nitro-Server** der Nuxt-App stellt die REST-API unter `/api/...` bereit – ein Prozess, ein Container.
- **SQLite** über **better-sqlite3**, Zugriff mit **Drizzle ORM**, Migrationen mit drizzle-kit;
  Migrationen laufen beim Serverstart automatisch.
- **Auth**: `nuxt-auth-utils` (verschlüsseltes Session-Cookie, Passwort-Hashing mit scrypt).
  Sperre nach 5 Fehlversuchen für 15 Minuten. Session-Laufzeit 30 Tage.
- **Zeitzone**: Europe/Berlin; Datumswerte als `YYYY-MM-DD`-Strings.
- **Node.js 24 LTS**.

### Code-Struktur

```
app/                    Nuxt frontend (pages, components, composables)
  locales/de.ts         all German UI strings in one place
server/
  api/                  route handlers (thin: auth check → service → response)
  services/             use cases operating on the database
  db/                   drizzle schema, migrations, connection
  utils/auth.ts         requireUser / requireAdmin helpers
shared/domain/          pure TypeScript, no framework/DB imports:
  time.ts               minutes, durations, break handling
  holidays.ts           Baden-Württemberg holidays (Easter algorithm)
  targets.ts            daily target from weekly-hours history
  balance.ts            daily credit, weekly summary, account balance
  leave.ts              vacation account
  warnings.ts           missing entry, coverage rules, target hint
  dayOverview.ts        15-minute timeline and presence counts
tests/                  vitest: domain unit tests, service/API tests
```

Die Fachlogik in `shared/domain/` ist unabhängig von Nuxt und Datenbank und wird vom Server
(Berechnung, Rechteprüfung) und – wo sinnvoll – vom Frontend (sofortige Anzeige) genutzt.

### Datenmodell

| Tabelle | Felder (Auszug) |
|---|---|
| `users` | id, username, password_hash, role (`admin`/`observer`), employee_id?, must_change_password, failed_logins, locked_until, active |
| `employees` | id, name, short_name, sort_order, left_on? |
| `employee_hours` | id, employee_id, weekly_minutes, valid_from |
| `balance_adjustments` | id, employee_id, date, minutes (±), reason |
| `leave_entitlements` | id, employee_id, year, days, carried_over_days |
| `shift_templates` | id, short_label, label, start, end, break_start?, break_end?, counts_as_staff, sort_order |
| `absence_codes` | id, key, label, color, credit_mode (`daily_target`/`timed`/`none`), requires_times, sort_order |
| `entries` | id, employee_id, date, kind (`shift`/`special`/`code`), shift_template_id?, absence_code_id?, start?, end?, break_start?, break_end?, counts_as_staff, note?, closure_id?, updated_at, updated_by |
| `day_notes` | date (PK), info1, info2 |
| `closures` | id, start_date, end_date, label, mode (`vacation`/`closure_day`) |
| `month_plans` | year, month (PK), released_at?, released_by? (neueste Freigabe) |
| `release_snapshots` | id, year, month, released_at, released_by, data (JSON: Mitarbeiterspalten, Einträge, Info-Spalten, Schließzeit-Bezeichnungen je Tag) |
| `change_log` | id, date, employee_id?, field (`entry`/`info1`/`info2`), before (JSON), after (JSON), changed_at, changed_by |
| `coverage_rules` | id, label, start, end?, min_count, active |

Dienste aus Vorlagen speichern ihre Zeiten beim Eintragen mit (Kopie), damit spätere Änderungen
an einer Vorlage alte Pläne nicht verändern.

## 6. Betrieb

- **Docker-Image** (Multi-Stage-Build, `node:24-slim`), läuft als Nicht-Root-Benutzer, Port 3000.
- **Volume** `/data` enthält `app.db`.
- **Umgebungsvariablen**: `NUXT_SESSION_PASSWORD` (mind. 32 Zeichen), `ADMIN_USERNAME`,
  `ADMIN_PASSWORD` (nur beim ersten Start genutzt, Passwortwechsel wird erzwungen), `TZ=Europe/Berlin`.
- **Health-Check** `/api/health`.
- Mitgeliefert: `docker-compose.yml`, Beispielkonfiguration für einen vorgeschalteten Webserver
  mit HTTPS (Caddy), Anleitung zu Installation, Update und Backup (auf Deutsch, für Nicht-Techniker).
- **Backup**: Button „Datenbank herunterladen“ (konsistente Kopie über die SQLite-Backup-Funktion) +
  Anleitung für automatische Sicherung auf dem Server.

## 7. Tests

- **Fachlogik** (`shared/domain`): testgetrieben mit Vitest – Pausenabzug, Tagessoll mit Historie,
  Anrechnungsregeln, Wochen/Konto, Urlaubskonto, BW-Feiertage mehrerer Jahre, alle Warnungen,
  Tagesübersicht.
- **Services/API**: Vitest gegen eine In-Memory-SQLite – insbesondere Rechte
  (Beobachter erhält keine Stunden, keine fremden Urlaubskonten, keine Entwürfe),
  Schließzeiten erzeugen/entfernen Einträge, Änderungsprotokoll nach Freigabe.
- **Manuelle Prüfung** der Oberfläche im Browser vor Abschluss.

## 8. Nicht im ersten Entwurf

- GitHub-Actions-Pipeline (Tests, Image bauen, Container-Smoke-Test, Veröffentlichung in der
  GitHub Container Registry) – folgt direkt nach dem ersten Entwurf.
- Excel-Export, E-Mail-Benachrichtigungen, halbe Urlaubstage, Bearbeitung auf dem Handy,
  unterschiedliche Anzahl Arbeitstage pro Woche (Tagessoll ist immer Wochenstunden ÷ 5).
