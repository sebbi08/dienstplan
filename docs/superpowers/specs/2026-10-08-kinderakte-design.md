# Kinderakte (Gruppenbuch, Stufe 1) – Design

Stand: 08.10.2026 · Baut auf Einrichtungen, Aushelfen und Gruppen auf
([2026-10-07-facilities-design.md](2026-10-07-facilities-design.md),
[2026-10-07-help-outs-design.md](2026-10-07-help-outs-design.md),
[2026-10-08-groups-design.md](2026-10-08-groups-design.md)).
Grundlage der Inhalte: die Excel-Vorlage `Gruppenbuch1.xlsx` der Kita.

## 1. Ziel

Die App bekommt eine Kinderverwaltung: pro Kita eine Liste der Kinder mit einer Akte je Kind (Stammdaten,
Bezugspersonen, Gesundheit, Einwilligungen, Dokumente). Sie ersetzt die Excel-Blätter Geburtstage, Daten,
Telefonnummern, Notfallkontakte, Abholberechtigte, Sorgeberechtigte, Grundschule, Gesundheit, Datenschutz und
WhatsApp.

Das Gruppenbuch wird in drei Stufen gebaut, jede mit eigener Beschreibung und eigenem Bauplan:

1. **Kinderakte** (dieses Dokument).
2. **Anwesenheit der Kinder:** Ein- und Ausstempeln mit Bring- und Abholzeit, siehe Abschnitt 12.
3. **Tagesprotokoll:** pro Gruppe und Tag, was gemacht wurde, mit Wochenübersicht.

**Erfolgskriterien**

- Alle Angaben der Excel-Vorlage lassen sich pro Kind in der App pflegen. Keine Person muss mehrfach
  eingetragen werden.
- Kontaktverbote, Allergien und Notfallkontakte sind für alle Mitarbeiter der Kita mit einem Blick sichtbar.
- Die Leitung sieht in einer Tabelle, welche nötigen Dokumente bei welchem Kind fehlen.
- Vertrauliche Dokumente sieht nur, wer sie sehen darf – serverseitig abgesichert.
- Abgemeldete Kinder werden nach der eingestellten Frist automatisch vollständig gelöscht.

**Entscheidungen der Leitung (Brainstorming 08.10.2026):**

| Thema | Entscheidung |
|---|---|
| Wer arbeitet damit | Mitarbeiter der Kita sehen alle Kinder ihrer Kita und tragen später (Stufe 2/3) Anwesenheit und Protokoll ein. Leitung pflegt die Akten. |
| Kinder anlegen | Die Leitung kann einzelnen Mitarbeitern „darf Kinderakten pflegen“ freischalten: anlegen und ändern, nicht abmelden/löschen. |
| Träger | Voller Zugriff in allen Kitas, kann Kinder eintragen. |
| Sichtbarkeit | Mitarbeiter sehen alle Kinder ihrer Kita (nicht nur ihrer Gruppe). |
| Dokumente | Pro Dokument „alle Mitarbeiter“ oder „vertraulich“. |
| Abmeldung | Archiv; nach einer Frist (Träger, Vorschlag 3 Jahre) löscht die App automatisch. |
| Betreuungsformen | Liste pro Kita mit Zeiten, von der Leitung gepflegt. |
| Speicherort Dokumente | In der Datenbank (damit in jeder Datensicherung enthalten). |
| Dokumentübersicht | Tabelle Kinder × wichtige Dokumentarten. |

## 2. Begriffe

- **Kind:** gehört zu genau einer Kita und, wenn die Kita Gruppen hat, zu genau einer Gruppe.
- **Aktiv / geplant / archiviert:** Ein Kind ist **geplant**, solange sein Eintritt in der Zukunft liegt oder
  kein Eintritt, aber ein geplanter Eintritt eingetragen ist; **aktiv** ab dem Eintritt bis einschließlich
  Austrittsdatum; danach **archiviert**.
- **Bezugsperson:** eine Person mit Bezug zu einem Kind (Mutter, Vater, Oma, Nachbarin …) mit Rollen-Häkchen.
- **Pfleger der Akte:** Träger, Leitung oder ein Mitarbeiter mit Freischaltung (Abschnitt 4).
- **Betreuungsform:** z. B. „VÖ 7:00–13:30“, „GT 7:00–17:00“; Liste pro Kita.
- **Dokumentart:** z. B. „Masernnachweis“; Liste pro Kita mit den Eigenschaften *wichtig*, *für jedes Kind
  nötig* und *vertraulich (Voreinstellung)*.

## 3. Kinderliste

Neuer Menüpunkt **„Kinder“** für Träger, Leitung und Mitarbeiter (nicht für das Stempel-Tablet), immer für
die gewählte bzw. eigene Kita. Reiter:

- **Liste:** aktive Kinder, gruppiert nach Gruppe (Reihenfolge der Gruppen), darin nach Nachname, Vorname.
  Spalten: Name, Alter (Jahre und Monate), Betreuungsform, Eintritt. Symbole: Warnsymbol bei Allergien,
  rotes Symbol bei mindestens einem Kontaktverbot (Tooltip mit Text). Suche nach Namen, Filter nach Gruppe.
  Knopf **„Kind anlegen“** nur für Pfleger der Akte.
- **Geplant:** Kinder mit geplantem bzw. künftigem Eintritt, nach Datum sortiert.
- **Geburtstage:** aktive Kinder mit Geburtstag in den nächsten 8 Wochen (Datum, neues Alter); Druckansicht
  aller aktiven Kinder nach Monat und Tag sortiert (wie Excel-Blatt „Geburtstage“).
- **Dokumente:** Übersichtstabelle (Abschnitt 7).
- **Archiv:** nur Leitung und Träger (Abschnitt 8).

Kinder ohne Gruppe (Kita ohne Gruppen oder Gruppe noch nicht gewählt) stehen in einem Block „ohne Gruppe“.

## 4. Rechte

| | Träger | Leitung | Mitarbeiter mit Freischaltung | übrige Mitarbeiter | Stempel-Tablet |
|---|---|---|---|---|---|
| Liste und Akten ansehen | gewählte Kita | eigene Kita | eigene Kita | eigene Kita | nein |
| Kind anlegen, Akte ändern, Dokumente hochladen/ändern/löschen | ja | ja | ja | nein | nein |
| Vertrauliche Dokumente öffnen | ja | ja | ja | nein (nur Zeile mit Schloss) | nein |
| Kind abmelden, Abmeldung zurücknehmen, Archiv, Akte sofort löschen | ja | ja | nein | nein | nein |
| Freischaltung vergeben | ja | ja | nein | nein | nein |
| Betreuungsformen und Dokumentarten pflegen | ja | ja | nein | nein | nein |
| Löschfrist einstellen | ja | nein | nein | nein | nein |
| Kind in andere Kita verschieben | ja | nein | nein | nein | nein |

- „Eigene Kita“ eines Mitarbeiters ist seine Stamm-Kita (die Kita des verknüpften Mitarbeiters, wie bei den
  übrigen `my/*`-Seiten). Ein Mitarbeiter-Konto ohne verknüpften Mitarbeiter sieht keine Kinder.
- Aushilfen aus einer anderen Kita sehen deren Kinder nicht.
- Die **Freischaltung** ist ein Häkchen „darf Kinderakten pflegen“ am Benutzerkonto (Seite „Benutzer“); es ist
  nur bei Mitarbeiter-Konten wählbar und gilt für dessen Stamm-Kita. Leitung und Träger haben das Recht immer.
- Alle Rechte werden serverseitig in jeder Route geprüft. Kinder, Bezugspersonen, Dokumente, Betreuungsformen
  und Dokumentarten einer anderen Kita werden mit 404 (`*_not_found`) beantwortet. Ein vertrauliches Dokument
  ohne Recht wird mit 404 `document_not_found` beantwortet.
- **Nachvollziehbarkeit:** Jeder Bereich der Akte (Stammdaten, Bezugspersonen, Gesundheit, Einwilligungen)
  zeigt „zuletzt geändert von … am …“. Ein vollständiges Änderungsprotokoll ist nicht Teil dieses Designs.

## 5. Kinderakte

Eine Seite pro Kind. Oben ein Kasten **„Wichtig“**: alle Kontaktverbote (Name + Hinweis, rot), Allergien
(Text), Notfallkontakte in Reihenfolge mit Telefonnummern (anklickbar zum Anrufen).

### 5.1 Stammdaten

Nachname, Vorname (Pflicht), Geburtsdatum (Pflicht), Adresse (Freitext, mehrzeilig), Gruppe (wenn die Kita
Gruppen hat), Betreuungsform, Eintritt, geplanter Eintritt, Infogespräch (Datum), voraussichtlicher Schulstart
(Datum), Grundschule (Text), Bemerkung (Freitext).

Validierung: Geburtsdatum nicht in der Zukunft; Gruppe und Betreuungsform aus der eigenen Kita.

### 5.2 Bezugspersonen

Liste pro Kind, Reihenfolge änderbar. Je Person:

- Name (Pflicht), Beziehung (Freitext mit Vorschlägen: Mutter, Vater, Oma, Opa, Tante, Onkel, Nachbar/in)
- Telefon privat, Telefon mobil, Telefon Arbeit (je optional)
- Häkchen: **sorgeberechtigt**, **darf abholen**, **Notfallkontakt** (mit Rang 1, 2, 3 …), **Kontaktverbot**
  (mit Pflicht-Hinweistext, z. B. „gerichtlich, Kopie im Ordner“)
- Bemerkung

Regeln: Eine Person mit Kontaktverbot kann nicht gleichzeitig „darf abholen“ oder „Notfallkontakt“ sein
(Fehler `contact_ban_conflict`). Excel-Spalten „Prio 1/2“ entsprechen den Notfallkontakt-Rängen.

### 5.3 Gesundheit

- Masernnachweis: ja / nein / offen, mit Datum
- Belehrung Infektionsschutz: Datum (leer = offen)
- Allergien und Unverträglichkeiten: Freitext
- Erlaubnisse: Fieber messen, Sonnenschutz auftragen, Pflaster kleben – je ja / nein / offen

### 5.4 Einwilligungen

Je ja / nein / offen:

- Datenschutz: Bastel- und Malarbeiten aufhängen; Einzel- und Gruppenfotos aufhängen; Fotoerlaubnis für fremde
  Portfolios; Fotos hausinterner Feste; Fotos über WhatsApp versenden; Fotos, Namen und Geburtsdaten aufhängen;
  Gruppenarbeiten mit Namen ausstellen
- WhatsApp: Kontaktaufnahme über WhatsApp; Fotos über WhatsApp; WhatsApp-Elterngruppe

„Offen“ wird grau hervorgehoben, damit fehlende Antworten auffallen.

## 6. Dokumente

- **Hochladen** (Pfleger der Akte): PDF, JPEG, PNG; höchstens 10 MB je Datei. Der Server prüft den Dateityp an
  den ersten Bytes (Signatur), nicht am Namen; sonst Fehler `document_type_invalid` bzw. `document_too_large`.
  Auf dem Handy kann direkt fotografiert werden.
- **Angaben:** Dokumentart (Pflicht), Bezeichnung (optional), Datum des Dokuments (Voreinstellung heute),
  Sichtbarkeit „alle Mitarbeiter“ oder „vertraulich“ (Voreinstellung aus der Dokumentart).
- Mehrere Dokumente je Art sind erlaubt.
- **Liste in der Akte:** Art, Bezeichnung, Datum, Sichtbarkeit, „hochgeladen von … am …“. Öffnen im neuen Tab
  oder Herunterladen. Vertrauliche Dokumente sehen übrige Mitarbeiter als Zeile mit Schloss ohne Öffnen.
- **Ändern / Löschen** (Pfleger der Akte): Art, Bezeichnung, Datum, Sichtbarkeit ändern; Löschen mit Bestätigung.
- **Sicherheit:** Dateien nur über eine Route mit Rechteprüfung; Antwort mit dem geprüften Typ,
  `Content-Disposition` (inline bzw. attachment), `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`.
  Keine öffentlichen Links.

## 7. Dokumentarten und Übersichtstabelle

**Dokumentarten** (pro Kita, Leitung und Träger, Einstellungsseite): Name (eindeutig je Kita), *wichtig*
(Spalte in der Übersicht), *für jedes Kind nötig* (nur zusammen mit *wichtig*), *vertraulich* (Voreinstellung
beim Hochladen), Reihenfolge. Eine Art mit Dokumenten kann nicht gelöscht werden (`document_type_in_use`).

Vorbelegung für jede Kita (bei bestehenden Kitas durch die Umstellung, bei neuen beim Anlegen):

| Art | wichtig | nötig | vertraulich |
|---|---|---|---|
| Betreuungsvertrag | ja | ja | ja |
| Masernnachweis | ja | ja | nein |
| Belehrung Infektionsschutz | ja | ja | nein |
| Datenschutz-Einwilligung | ja | ja | nein |
| Sorgerechtsbeschluss | ja | nein | ja |
| Ärztliches Attest | nein | nein | ja |
| Sonstiges | nein | nein | nein |

**Übersichtstabelle** (Reiter „Dokumente“, alle Mitarbeiter): eine Zeile je aktivem Kind, eine Spalte je
wichtiger Art. Zelle: ✓ mit Datum des neuesten Dokuments dieser Art; ohne Dokument bei *nötigen* Arten rot
„fehlt“, sonst leer. Klick auf ✓ öffnet das Dokument, wenn man es sehen darf (vertraulich ohne Recht: ✓ mit
Schloss, nicht anklickbar). Filter „nur Kinder mit fehlenden Dokumenten“ (nur nötige Arten). Druckansicht.

## 8. Abmelden, Archiv, automatische Löschung

- **Abmelden** (Leitung, Träger): Austrittsdatum eingeben (darf in der Zukunft oder bis zu einem Jahr in der
  Vergangenheit liegen). Bis einschließlich Austrittsdatum bleibt das Kind aktiv, danach archiviert.
- **Archiv** (Leitung, Träger): archivierte Kinder mit Austrittsdatum und „wird gelöscht am …“. Akten im Archiv
  sind nur lesbar (keine Änderungen, keine Uploads). **Abmeldung zurücknehmen** setzt das Austrittsdatum zurück.
  **Sofort löschen** mit Bestätigung.
- **Löschfrist** (Träger, eine Einstellung für alle Kitas): ganze Jahre nach dem Austrittsdatum, 1–10,
  Vorbelegung 3. Löschdatum = Austrittsdatum + Frist.
- **Automatische Löschung:** Einmal täglich (im bestehenden stündlichen Takt des Datenbank-Plugins, höchstens
  einmal pro Kalendertag) löscht die App jedes Kind, dessen Löschdatum erreicht ist, mit allen Bezugspersonen
  und Dokumenten in einer Transaktion. Die Anzahl wird im Server-Log vermerkt (ohne Namen).
- Gelöschte Daten bleiben noch bis zu 14 Tage in den täglichen Sicherungskopien; das steht in der
  Betriebsanleitung.

## 9. Betreuungsformen

Pro Kita (Leitung, Träger, Einstellungsseite): Name (eindeutig je Kita), Beginn, Ende (5-Minuten-Raster, Ende
nach Beginn), Reihenfolge. Eine Form, die einem Kind zugeordnet ist, kann nicht gelöscht werden
(`care_type_in_use`). Keine Vorbelegung. In Stufe 1 werden die Zeiten nur angezeigt.

## 10. Gruppen- und Kita-Wechsel

- **Gruppenwechsel:** Gruppe in der Akte ändern; gilt sofort. Keine Gruppenhistorie (Stufe 2 speichert die
  Gruppe je Anwesenheitstag). Eine Gruppe mit aktiven oder geplanten Kindern kann – wie bei Mitarbeitern – nicht
  gelöscht werden (`group_has_children`); archivierte Kinder verlieren beim Löschen der Gruppe ihre Gruppe.
- **Kita-Wechsel** (nur Träger): Die Akte zieht mit allen Bezugspersonen und Dokumenten um; Gruppe und
  Betreuungsform werden geleert (gehören zur alten Kita); jedes Dokument bekommt die gleichnamige Dokumentart der
  neuen Kita oder, falls es keine gibt, „Sonstiges“ der neuen Kita (wird bei Bedarf angelegt).

## 11. Technik

### 11.1 Datenmodell (neue Tabellen, Migration 0023)

- `children`: id, facility_id, group_id (nullable, FK groups, ON DELETE SET NULL), care_type_id (nullable),
  last_name, first_name, birth_date, address, entry_date, planned_entry_date, info_meeting_date,
  school_start_date, primary_school, note, left_on (nullable), Gesundheits- und Einwilligungsfelder
  (ja/nein/offen als nullable integer 1/0/null; Datumsfelder als ISO-Text), je Bereich
  `<bereich>_updated_at` / `<bereich>_updated_by` (users, ON DELETE SET NULL), created_at.
- `child_contacts`: id, child_id (FK cascade), sort_order, name, relation, phone_home, phone_mobile, phone_work,
  is_guardian, may_pick_up, emergency_rank (nullable), contact_ban, contact_ban_note, note.
- `child_documents`: id, child_id (FK cascade), document_type_id (FK), title, document_date, confidential,
  mime_type, size, data (BLOB), uploaded_by, uploaded_at. Listen laden `data` nie mit.
- `document_types`: id, facility_id, name, important, required, confidential_default, sort_order.
- `care_types`: id, facility_id, name, start, end (Minuten), sort_order.
- `users.can_edit_children` (boolean, Standard false).
- App-Einstellung `child_retention_years` (Standard 3).

### 11.2 Server

- Neue Guards in `server/utils/auth.ts`: `requireChildReader(event)` (Träger/Leitung mit Kita oder Mitarbeiter
  mit Kita; nicht Tablet) und `requireChildEditor(event)` (Manager oder Mitarbeiter mit `can_edit_children`);
  Abmelden/Archiv/Löschen/Einstellungen über `requireAdmin`, Löschfrist und Kita-Wechsel über
  `requireProvider`. `tests/api/permissions.test.ts` bekommt die neuen Routen-Listen.
- Services: `server/services/children.ts` (Liste, Akte, Bereiche, Abmeldung, Archiv, Löschung, Kita-Wechsel),
  `childContacts.ts`, `childDocuments.ts` (Upload, Download, Übersicht), `documentTypes.ts`, `careTypes.ts`;
  Signatur `fn(db, facilityId, …)` wie überall.
- Upload über `readMultipartFormData`; Größenprüfung vor dem Speichern.
- Löschjob `purgeExpiredChildren(db, today)` im Datenbank-Plugin.
- Druckansichten (Geburtstage, Dokumentübersicht) über den vorhandenen PDF-Mechanismus.

### 11.3 Oberfläche

Seiten unter `/children` (Liste mit Reitern, `/children/new`, `/children/[id]`), Einstellungsbereiche
„Betreuungsformen“ und „Dokumentarten“, Häkchen auf der Benutzerseite, Löschfrist in den Träger-Einstellungen.

## 12. Ausblick Stufe 2 (festgehalten, nicht Teil dieser Stufe)

- Kinder werden pro Tag ein- und ausgestempelt (Uhrzeit).
- Beim Einstempeln: optional, wer das Kind bringt; Pflicht: geplante Abholzeit.
- Beim Ausstempeln: Pflicht, wer abholt (aus den Bezugspersonen mit „darf abholen“; Umgang mit fremden Personen
  wird in Stufe 2 geklärt).
- Pro Tag sichtbar: welche Kinder beim Snack und beim Mittagessen dabei sind.
- Monatsübersicht wie Excel-Blatt „Anwesenheit Kinder“ mit Bemerkung; Druckansicht.
- Zu jedem Anwesenheitstag wird die damalige Gruppe gespeichert; Betreuungszeiten können für Hinweise genutzt
  werden („noch nicht abgeholt nach Ende der Betreuungszeit“).

## 13. Umsetzung in Teilschritten

1. Datenmodell, Rechte, Freischaltung
2. Kinderliste und Akte (Stammdaten, Bezugspersonen, Gesundheit, Einwilligungen)
3. Dokumente, Dokumentarten, Übersichtstabelle
4. Abmelden, Archiv, automatische Löschung, Betreuungsformen, Kita-Wechsel
5. Geburtstage, Druckansichten, Betriebsanleitung (Abschnitt „Datenschutz“)

## 14. Tests

- **Rechte:** je Rolle Lesen/Schreiben; Mitarbeiter ohne Freischaltung kann nicht ändern; Freigeschalteter
  kann nicht abmelden/löschen; Tablet hat keinen Zugriff; fremde Kita → 404 für Kind, Bezugsperson, Dokument,
  Dokumentart, Betreuungsform; vertrauliches Dokument für übrige Mitarbeiter → 404 und nicht in Download;
  archivierte Akte nicht änderbar.
- **Upload:** falscher Typ, getarnte Datei (Name `.pdf`, Inhalt kein PDF), zu groß, korrekte Datei; Download
  liefert dieselben Bytes und die Sicherheits-Header.
- **Bezugspersonen:** Kontaktverbot schließt Abholen/Notfallkontakt aus; Reihenfolge; Notfallkontakt-Ränge im
  Kasten „Wichtig“.
- **Übersicht:** nötige Art fehlt → „fehlt“; wichtige, nicht nötige Art fehlt → leer; neuestes Dokument je Art;
  vertraulich ohne Recht → nicht anklickbar.
- **Abmelden/Löschen:** aktiv bis einschließlich Austritt; Archiv; Rücknahme; automatische Löschung genau am
  Löschdatum, vorher nichts gelöscht; nach Löschung keine Bezugspersonen und Dokumente mehr; nur einmal pro Tag.
- **Kita-Wechsel:** Dokumentarten werden zugeordnet, Gruppe/Betreuungsform geleert.
- **Migration:** bestehende Datenbank bekommt die Tabellen und je Kita die vorbelegten Dokumentarten; keine
  Fremdschlüsselverletzungen.

## 15. Nicht enthalten

- Anwesenheit, Ein-/Ausstempeln, Mahlzeiten (Stufe 2); Tagesprotokoll und Wochenübersicht (Stufe 3).
- Vollständiges Änderungsprotokoll der Akte.
- Gruppenhistorie eines Kindes.
- Zugriff für Eltern.
- Import aus der Excel-Datei (die Vorlage ist leer; Kinder werden in der App angelegt).
- Verschlüsselung der Datenbank auf dem Server (Sache des Server-Betriebs; Hinweis in der Betriebsanleitung).
