# Bundesland und Feiertage pro Einrichtung

Stand: 15.10.2026 · Baut auf Einrichtungen (Spec 2026-10-07), Platzplanung (Spec 2026-10-13, Stichtag Schulkinder) auf.

## 1. Ziel

Jede Einrichtung hat ein Bundesland. Die gesetzlichen Feiertage richten sich nach diesem Bundesland statt fest nach
Baden-Württemberg, und der Stichtag für Schulkinder wird beim Anlegen einer Einrichtung aus dem Bundesland
vorausgefüllt. Heute liegen alle Einrichtungen in Baden-Württemberg; für sie ändert sich nichts.

| Entschieden | |
|---|---|
| Wer stellt ein | Nur der Träger, bei „Einrichtungen“. Die Leitung sieht das Bundesland. |
| Bestehende Einrichtungen | Baden-Württemberg (Migration). |
| Bundesland ändern | Gilt sofort für alle Tage, auch rückwirkend; deutliche Warnung vor dem Speichern. |
| Stichtag Schulkinder | Beim Anlegen aus dem Bundesland vorausgefüllt; bei späterer Änderung des Bundeslands nur angezeigt mit Knopf „übernehmen“. |
| Feiertagsregeln | Für alle 16 Länder fest im Programm berechnet (keine Pflegeliste, kein Internetdienst). |
| Örtliche und einmalige Feiertage | Als Schließzeit (wie bisher). |
| Bayern | Häkchen „Mariä Himmelfahrt ist hier Feiertag“ pro Einrichtung, voreingestellt an. |
| Mitarbeiter | Soll-Arbeitszeit, Urlaubstage, Stundenzettel, eigener Kalender: Feiertage der **Stammeinrichtung**, auch an Aushilfstagen. |
| Einrichtung | Dienstplan, Warnungen, Wochenvorlagen, Jahreskalender der Leitung, Schließzeiten-Seite: Feiertage der Einrichtung. |

## 2. Bundesland einer Einrichtung

- Neue Spalte `facilities.state`: Kürzel des Bundeslands (`BW`, `BY`, `BE`, `BB`, `HB`, `HH`, `HE`, `MV`, `NI`, `NW`,
  `RP`, `SL`, `SN`, `ST`, `SH`, `TH`), Pflichtfeld, Voreinstellung `BW`. Alle bestehenden Einrichtungen bekommen `BW`.
- Neue Spalte `facilities.assumption_day` (boolean, Voreinstellung `true`): nur für `BY` wirksam (Mariä Himmelfahrt).
- Anzeige in Listen und Auswahlen mit dem vollen Namen („Baden-Württemberg“).

### 2.1 Anlegen

Der Träger wählt beim Anlegen das Bundesland (Voreinstellung Baden-Württemberg). Der Stichtag für Schulkinder der neuen
Einrichtung (Monat, Tag, Alter) wird aus der Tabelle in Abschnitt 4 gesetzt.

### 2.2 Ändern

- Vor dem Speichern eines anderen Bundeslands (oder des Bayern-Häkchens) zeigt die App:
  „Die Feiertage dieser Einrichtung ändern sich für alle Tage, auch rückwirkend. Sollstunden, Stundenkonten und
  Urlaubstage der Mitarbeiter dieser Einrichtung können sich dadurch auch für vergangene Monate ändern.“
  Speichern erst nach Bestätigung.
- Der eingestellte Stichtag bleibt unverändert. Weicht er vom Stichtag des neuen Bundeslands ab, zeigt der Abschnitt
  „Schulkinder“ den Stichtag des Bundeslands an, mit dem Knopf **„übernehmen“**. Übernehmen ist eine normale
  Stichtagsänderung: Sie schaltet wie bisher die automatische Abmeldung der Schulkinder aus (Platzplanung, Regel
  „Stichtagsänderung schaltet aus“).

### 2.3 Rechte

Ändern: nur Träger (`requireProvider(`), wie das Anlegen von Einrichtungen. Lesen: Leitung und Träger. Am Tablet nicht
verfügbar (Einstellungen).

## 3. Feiertage

### 3.1 Regeln

Bundesweit: Neujahr (1.1.), Karfreitag, Ostermontag, Tag der Arbeit (1.5.), Christi Himmelfahrt, Pfingstmontag, Tag
der Deutschen Einheit (3.10.), 1. und 2. Weihnachtstag (25./26.12.).

Zusätzlich:

| Feiertag | Datum | Länder |
|---|---|---|
| Heilige Drei Könige | 6.1. | BW, BY, ST |
| Internationaler Frauentag | 8.3. | BE, MV |
| Fronleichnam | Ostersonntag + 60 | BW, BY, HE, NW, RP, SL |
| Mariä Himmelfahrt | 15.8. | SL; BY, wenn `assumption_day` |
| Weltkindertag | 20.9. | TH |
| Reformationstag | 31.10. | BB, HB, HH, MV, NI, SN, ST, SH, TH |
| Allerheiligen | 1.11. | BW, BY, NW, RP, SL |
| Buß- und Bettag | Mittwoch vor dem 23.11. | SN |

- Ostersonntag und Pfingstsonntag (in einzelnen Ländern gesetzliche Feiertage) werden nicht geführt: Sie fallen immer
  auf einen Sonntag und ändern weder Sollzeit noch Urlaubstage.
- Die Regeln gelten so für alle Jahre ab 2024. Ältere Jahre (vor der Einführung z. B. des Frauentags in MV 2023) werden
  nicht unterschieden: Die App enthält keine Daten vor 2026.
- Örtliche Feiertage (Fronleichnam in einzelnen Gemeinden in SN und TH, Augsburger Friedensfest) und einmalige
  Sonderfeiertage (z. B. 8. Mai 2025 in Berlin) werden nicht berechnet; die Leitung trägt sie als Schließzeit ein.
  Der Hinweistext der Feiertagsliste sagt das.

### 3.2 Wo welche Feiertage gelten

| Bereich | Feiertage von |
|---|---|
| Soll-Arbeitszeit, Arbeitstage (`isWorkday`, `dailyTarget`), Stundenkonten, Stundenzettel | Stammeinrichtung des Mitarbeiters |
| Urlaubstage (was ein Urlaub kostet), Urlaubsanträge, Urlaubsplanung | Stammeinrichtung des Mitarbeiters |
| „Mein Kalender“ / Jahreskalender eines Mitarbeiters | Stammeinrichtung |
| Dienstplan einer Einrichtung (Feiertagszeilen, Hilfsspalte), Warnungen zur Besetzung, Wochenvorlagen anwenden, Schließzeiten buchen | die Einrichtung |
| Jahreskalender der Leitung, Seite „Schließzeiten“ (Feiertagsliste) | die Einrichtung |

- Wechselt ein Mitarbeiter die Stammeinrichtung, gelten die Feiertage der neuen Stammeinrichtung für alle Tage, auch
  rückwirkend (wie beim Ändern des Bundeslands). Liegen alte und neue Einrichtung in verschiedenen Bundesländern,
  zeigt der Wechsel-Dialog einen Hinweis darauf (gleicher Text sinngemäß wie in 2.2).
- Aushilfe: Ein Mitarbeiter aus Einrichtung A, der in B aushilft, hat Sollzeit und Urlaubstage nach A; im Plan von B
  erscheinen die Feiertage von B.

## 4. Stichtag für Schulkinder pro Bundesland

Vorausfüllung beim Anlegen und Anzeige „übernehmen“ (2.1, 2.2). Wortlaut wie im Gesetz: Schulpflichtig wird zum
Schuljahresbeginn, wer bis zum genannten Tag das sechste Lebensjahr vollendet. (Hinweis aus der Platzplanung: nach BGB
vollendet ein am 1. Juli geborenes Kind sein 6. Lebensjahr mit Ablauf des 30. Juni.)

Die App rechnet wie bisher: Ein Kind ist Schulkind, wenn sein 6. Geburtstag am oder vor dem Stichtag liegt. Vorausgefüllt
wird der im Gesetz genannte Tag. Nur wo die Behörde den Geburtszeitraum ausdrücklich anders veröffentlicht, gilt dieser
(Hamburg: geboren bis 1. Juli). Bei Ländern mit Einschulungskorridor zählt die Grenze, bis zu der Kinder ohne
Elternerklärung schulpflichtig sind; ein Kind, das die Eltern zurückstellen, bekommt wie bisher seinen Schulbeginn in
der Akte von Hand.

Geprüft am 15.10.2026 an den Landesrecht-Portalen bzw. Ministeriumsseiten. Für 2027/28 ist in keinem Land eine
Änderung bekannt.

| Land | Vorausgefüllter Stichtag (Alter 6) | Wortlaut / Besonderheit | Rechtsgrundlage |
|---|---|---|---|
| Baden-Württemberg | 30.06. | „bis 30. Juni … das sechste Lebensjahr vollendet“ (seit 2022/23) | § 73 Abs. 1 SchG BW |
| Bayern | 30.09. | bis 30.6. schulpflichtig; 1.7.–30.9. schulpflichtig, wenn die Eltern nicht verschieben (Korridor) | Art. 37 Abs. 1 BayEUG |
| Berlin | 30.09. | „bis zum folgenden 30. September vollenden werden“ | § 42 Abs. 1 SchulG Berlin |
| Brandenburg | 30.09. | „bis zum 30. September das sechste Lebensjahr vollendet“ | § 37 Abs. 3 BbgSchulG |
| Bremen | 30.06. | bis 30.6.; 1.7.–30.9. nur auf Antrag der Eltern | § 53 Abs. 1, 2 BremSchulG |
| Hamburg | 01.07. | „vor dem 1. Juli das 6. Lebensjahr vollendet“; Behörde: Geburtszeitraum bis 1. Juli | § 38 Abs. 1 HmbSG |
| Hessen | 30.06. | „bis zum 30. Juni das sechste Lebensjahr vollenden“ | § 58 Abs. 1 HSchG |
| Mecklenburg-Vorpommern | 30.06. | „spätestens am 30. Juni … sechs Jahre alt werden“ | § 43 Abs. 1 SchulG M-V |
| Niedersachsen | 30.09. | bis 30.9.; Eltern können 1.7.–30.9. um ein Jahr verschieben (Korridor) | § 64 Abs. 1 NSchG |
| Nordrhein-Westfalen | 30.09. | „bis zum Beginn des 30. September … vollendet“ | § 35 Abs. 1 SchulG NRW |
| Rheinland-Pfalz | 31.08. | „bis zum 31. August das sechste Lebensjahr vollenden“ | § 57 SchulG RP |
| Saarland | 30.06. | „bis zum 30. Juni … vollenden“ | § 2 Abs. 1 SchulPflG SL |
| Sachsen | 30.06. | bis 30.6.; bis 30.9. nur bei Anmeldung durch die Eltern | § 27 Abs. 1 SächsSchulG |
| Sachsen-Anhalt | 30.06. | „bis zum 30. Juni das sechste Lebensjahr vollenden“ | § 37 Abs. 1 SchulG LSA |
| Schleswig-Holstein | 30.06. | „bis zum 30. Juni … sechs Jahre alt geworden“ | § 22 Abs. 1 SchulG SH |
| Thüringen | 01.08. | „am 1. August eines Jahres sechs Jahre alt sind“ | § 18 Abs. 1 ThürSchulG |

Der Hinweistext beim Stichtag sagt: „Vorschlag nach dem Schulgesetz des Bundeslands (Stand Oktober 2026). Bitte bei
Änderungen des Schulgesetzes prüfen.“

## 5. Technik

### 5.1 Datenmodell (eine Migration, nächste Nummer nach 0032)

- `facilities.state` text not null default `'BW'`; `facilities.assumption_day` boolean not null default true.

### 5.2 Domäne (`shared/domain/holidays.ts`)

- `type GermanState = 'BW' | 'BY' | … | 'TH'` und `GERMAN_STATES` (Reihenfolge und deutsche Namen in `de.ts`).
- `interface HolidayRules { state: GermanState; assumptionDay: boolean }`.
- `holidaysOf(rules, year): Map<IsoDate, HolidayKey>` (zwischengespeichert pro Regel und Jahr), `holidayOn(date, rules)`,
  `isHoliday(date, rules)`. `bwHolidays` entfällt; neue `HolidayKey`s: `womens_day`, `assumption_day`,
  `childrens_day`, `reformation_day`, `repentance_day` (deutsche Namen in `de.holidays`).
- `schoolCutoffOf(state): SchoolCutoff` (Tabelle aus Abschnitt 4).
- Die Funktionen, die heute `isHoliday(date)` ohne Bundesland rufen (`isWorkday`, `dailyTarget`, `countsAsLeaveDay`,
  `isCheckedDay`, Kalender, Plan, Stundenzettel, Wochenvorlagen), bekommen die Regeln übergeben. Für Mitarbeiter trägt
  `EmploymentInfo` die Regeln der Stammeinrichtung (`holidays: HolidayRules`), geladen in `loadEmployee`/`loadEmployees`.

### 5.3 Server und Oberfläche

- Einrichtung anlegen/ändern (`facilities.post`, `facilities/[id].put`) nehmen `state` und `assumptionDay` an; Prüfung
  gegen die 16 Kürzel (400 `state_invalid`). Anlegen setzt den Stichtag aus `schoolCutoffOf(state)`.
- `SchoolSettingsDto` bekommt `stateCutoff` (Stichtag des Bundeslands) für die Anzeige „übernehmen“.
- Einrichtungs-Abschnitt in den Einstellungen: Auswahl Bundesland, bei Bayern das Häkchen, Bestätigungsdialog (2.2).
- Seite „Schließzeiten“: Feiertagsliste der aktiven Einrichtung mit Überschrift „Feiertage in ‹Bundesland›“.
- Wechsel der Stammeinrichtung: Hinweis bei verschiedenen Bundesländern (3.2).

## 6. Tests

- Domäne: Feiertage aller 16 Länder für 2024, 2025, 2026 und 2027 gegen einen festen Kalender (Tabelle im Test),
  einschließlich Buß- und Bettag (2024: 20.11.; 2025: 19.11.; 2026: 18.11.; 2027: 17.11.), Fronleichnam, Bayern mit
  und ohne Mariä Himmelfahrt.
- Services: eine Einrichtung in Berlin → 8.3. ist kein Arbeitstag, Sollzeit und Urlaubstage entsprechend; dieselbe
  Person in BW hat am 8.3. Soll und zahlt einen Urlaubstag; Aushilfe in einer anderen Einrichtung → Sollzeit nach
  Stammeinrichtung, Plan der Hilfseinrichtung zeigt deren Feiertage.
- Migration: bestehende Einrichtungen werden `BW`, alle bisherigen Ergebnisse (Sollzeiten, Urlaubstage) bleiben gleich
  (die bestehende Test-Suite muss unverändert grün bleiben).
- Anlegen: Stichtag aus dem Bundesland; Ändern: Stichtag bleibt, `stateCutoff` wird geliefert; ungültiges Kürzel 400;
  nur Träger.

## 7. Nicht enthalten

- Örtliche Feiertage einzelner Gemeinden und einmalige Sonderfeiertage (→ Schließzeiten).
- Ein Bundesland, das ab einem Datum gilt (Änderungen gelten rückwirkend, siehe 2.2).
- Schulferien.
