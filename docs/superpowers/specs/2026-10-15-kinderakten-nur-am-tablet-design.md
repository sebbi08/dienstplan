# Kinderakten nur am Tablet

Stand: 15.10.2026 · Baut auf der Kinderakte (Spec 2026-10-08) und der Platzplanung (Spec 2026-10-13) auf.

## 1. Ziel

Mitarbeiter sehen Kinderdaten nur noch am Tablet ihrer Einrichtung. Auf dem eigenen Handy oder einem privaten
PC bekommen sie mit ihrem persönlichen Konto keine Kinderinformationen mehr – weder im Menü noch über einen
direkten Link. Grund ist der Datenschutz: Kinderdaten sollen das Haus nicht verlassen.

Am Tablet schließt eine Person die Kinder mit Name und PIN auf; nach einer einstellbaren Zeit ohne Bedienung
sperrt sich das Tablet wieder.

| Entschieden | |
|---|---|
| Aufschließen | Name antippen + Stempel-PIN, wie beim Stempeln. |
| Bauweise | Die bestehenden Kinderseiten laufen auch am Tablet (keine zweiten, eigenen Tablet-Seiten). |
| Rechte am Tablet | Wie das Konto der Person; ohne Konto nur lesen; Aushilfen nur lesen und nur an Einsatztagen. |
| Leitung, Träger | Unverändert auf allen Geräten; zusätzlich am Tablet. |
| Sperrzeit | Pro Einrichtung einstellbar durch Leitung und Träger, Voreinstellung 2 Minuten. |
| Vormerkungen, künftige Vertragskinder | Je ein Schalter pro Einrichtung, ob sie am Tablet für Mitarbeiter und Aushilfen sichtbar sind (Voreinstellung aus). |
| Dokumente am Tablet | Anzeige innerhalb der App (PDF und Fotos), kein Herunterladen, nichts bleibt auf dem Gerät. |
| Gerät | Noch offen / verschiedene Geräte – die Lösung muss auf iPad und Android gleich sicher sein. |

## 2. Begriffe

- **Tablet**: das gemeinsame Gerätekonto (Rolle `terminal`) einer Einrichtung, das dauerhaft angemeldet bleibt.
- **Aufschließen**: Eine Person wählt am Tablet ihren Namen und gibt ihre PIN ein. Danach ist das Tablet für diese
  Person **aufgeschlossen**.
- **Aufschließende Person**: Wer aufgeschlossen hat. Ihre Rechte gelten, solange aufgeschlossen ist.
- **Sperren**: Das Aufschließen endet. Danach sieht am Tablet niemand mehr Kinderdaten.

## 3. Aufschließen und Sperren

### 3.1 Startseite des Tablets

Die Startseite `/terminal` bekommt zwei große Knöpfe: **„Stempeln“** (der bisherige Ablauf) und **„Kinder“**.

Unter „Kinder“ erscheinen dieselben Personen wie beim Stempeln: Mitarbeiter der Einrichtung, die heute beschäftigt
sind und eine PIN haben, und Aushilfen, die heute in dieser Einrichtung eingeplant sind. Name antippen, PIN eingeben
(dasselbe Ziffernfeld wie beim Stempeln), dann öffnet sich die Kinderliste.

### 3.2 Sperren

Das Tablet sperrt sich,

- wenn die Sperrzeit ohne Bedienung abgelaufen ist (Antippen, Tippen, Scrollen zählen als Bedienung),
- wenn jemand auf **„Sperren“** tippt,
- wenn jemand zum Stempeln wechselt (Startseite oder „Stempeln“),
- wenn eine andere Person aufschließt (es ist immer höchstens eine Person aufgeschlossen).

So erbt die nächste Person nie die Freischaltung der vorigen. Nach dem Sperren zeigt das Tablet wieder die
Startseite.

### 3.3 Sicherheit

- Der Server merkt sich jedes Aufschließen selbst (nicht nur der Bildschirm). Jede Anfrage nach Kinderdaten prüft,
  ob das Aufschließen noch gilt; nach Ablauf der Sperrzeit lehnt der Server ab (403 `tablet_locked`), und das Tablet
  springt zur Startseite.
- Das Aufschließen gehört zu genau diesem Tablet (seiner Sitzung). Ein anderes Gerät, das mit demselben
  Gerätekonto angemeldet ist, ist dadurch nicht aufgeschlossen.
- Bei jeder Anfrage werden die Rechte der aufschließenden Person frisch gelesen. Eine entzogene Freischaltung, eine
  gelöschte PIN oder ein beendetes Arbeitsverhältnis wirken sofort; ist die Person heute nicht mehr in der Liste aus
  3.1, endet das Aufschließen.
- PIN-Fehlversuche zählen gemeinsam mit dem Stempeln: Nach 5 falschen PINs ist die Person 15 Minuten gesperrt
  (beim Stempeln und beim Aufschließen).
- Eine Änderung der Sperrzeit gilt sofort, auch für ein gerade aufgeschlossenes Tablet.

## 4. Rechte

### 4.1 Am Tablet

| Aufschließende Person | Darf |
|---|---|
| Eigener Mitarbeiter **ohne** Benutzerkonto (nur PIN) | lesen |
| Eigener Mitarbeiter mit Konto „Mitarbeiter“ | lesen |
| Eigener Mitarbeiter mit Konto „Mitarbeiter“ + Freischaltung „Kinder bearbeiten“ | lesen, Kinder anlegen, bearbeiten, Dokumente hochladen, vertrauliche Dokumente sehen |
| Eigener Mitarbeiter mit Konto „Leitung“ oder „Träger“ | alles auf den Kinderseiten, was dieses Konto im Büro darf (auch Belegung, Archiv, Gruppenwechsel, Abmelden, Löschen) |
| Aushilfe aus einer anderen Einrichtung (an einem Einsatztag) | nur lesen, unabhängig von ihrem Konto |

- „Eigener Mitarbeiter“ heißt: Die Stammeinrichtung des Mitarbeiters ist die Einrichtung des Tablets.
- Es zählt nur ein **aktives** Konto, das mit dem Mitarbeiter verknüpft ist. Ohne Konto oder mit deaktiviertem Konto:
  nur lesen.
- Vertrauliche Dokumente sehen wie bisher nur die, die bearbeiten dürfen.
- Nur am Büro-Zugang, auch für Leitung und Träger am Tablet nicht verfügbar: alle **Einstellungen** (Betreuungsformen,
  Dokumentarten, Schulkinder, Löschfrist, Tablet …) und der Wechsel eines Kindes in eine andere Einrichtung.
- Änderungen am Tablet werden unter dem Konto der aufschließenden Person gespeichert (z. B. „hochgeladen von“). Wer
  nur lesen darf, ändert nichts.

### 4.2 Mit dem eigenen Konto

| Konto | Kinderdaten |
|---|---|
| Mitarbeiter (auch mit Freischaltung) | **keine**, auf keinem Gerät. Der Menüpunkt „Kinder“ entfällt; die Seiten leiten zur Startseite um; der Server lehnt jede Kinder-Anfrage ab (403 `children_tablet_only`). |
| Leitung, Träger | unverändert |

Dienstplan, Stempeln mit dem eigenen Konto, Urlaub, Termine und Kalender bleiben für Mitarbeiter unverändert.

Die Freischaltung „Kinder bearbeiten“ in der Benutzerverwaltung bleibt; ihr Hinweistext sagt künftig: „Gilt am
Tablet der Einrichtung. Mit dem eigenen Konto sehen Mitarbeiter keine Kinder.“

## 5. Die Kinderseiten am Tablet

- Am Tablet gibt es dieselben Kinderseiten wie im Büro: **Liste, Vormerkungen & Verträge, Geburtstage, Dokumente,
  Offen**, für Leitung und Träger auch **Belegung** und **Archiv**, dazu die vollständige Akte und „Kind anlegen“
  (wer darf).
- Oben steht ein Balken **„Aufgeschlossen: ‹Name›“** mit dem Knopf **„Sperren“**. Das übrige Menü der App ist am
  Tablet ausgeblendet; „Sperren“ führt zurück zur Startseite.
- Was eine Person nicht darf, zeigt das Tablet wie im Büro nicht an (z. B. Bearbeiten-Knöpfe für Leser).
- Beim Hochladen eines Dokuments gibt es zusätzlich zum Datei-Auswählen den Knopf **„Foto aufnehmen“**, der die
  Kamera des Tablets öffnet. Es gelten dieselben Regeln wie bisher (PDF, JPEG, PNG; höchstens 10 MB).

### 5.1 Vormerkungen und künftige Vertragskinder

Zwei Schalter pro Einrichtung (Abschnitt 7) steuern, ob das Tablet sie zeigt:

- **„Vormerkungen am Tablet zeigen“** – aus: Das Tablet zeigt keine Vormerkungen.
- **„Künftige Kinder mit Vertrag am Tablet zeigen“** – aus: Ein Kind mit Vertrag erscheint am Tablet erst ab seinem
  Eintrittstag (ohne Eintrittsdatum: gar nicht).

Ein ausgeblendetes Kind fehlt am Tablet überall (Listen, Geburtstage, Dokumente, Offen), und der direkte Aufruf seiner
Akte oder seiner Dokumente wird mit 404 `child_not_found` beantwortet. Sind beide Schalter aus, fehlt der Reiter
„Vormerkungen & Verträge“; ist nur einer an, zeigt der Reiter nur diesen Teil.

Die Schalter gelten für alle aufschließenden Personen ohne Leitungsrechte (Mitarbeiter mit und ohne Freischaltung,
Aushilfen). Leitung und Träger sehen – im Büro wie am Tablet – wie bisher alle Kinder; Belegung und Archiv sind von
den Schaltern nicht betroffen.

## 6. Dokumente am Tablet

Manche Tablets (vor allem Android) legen ein geöffnetes PDF automatisch im Download-Ordner ab, wo es nach dem Sperren
liegen bliebe. Deshalb gilt am Tablet:

- Dokumente öffnen sich in einer **Anzeige innerhalb der App**: PDFs Seite für Seite, Fotos als Bild. Die Datei wird
  nur im Arbeitsspeicher gehalten und beim Schließen der Anzeige oder beim Sperren verworfen.
- Am Tablet gibt es **kein Herunterladen** und keinen Link, der die Datei direkt im Browser öffnet.
- Der Server liefert Dateien wie bisher mit `Cache-Control: no-store`.
- Im Büro bleibt alles wie bisher (Öffnen im Browser, Herunterladen).

Grenze: Ein Bildschirmfoto am Tablet kann die App nicht verhindern.

## 7. Einstellungen: Abschnitt „Tablet“

Neuer Abschnitt in den Einstellungen, für Leitung und Träger, pro Einrichtung:

| Einstellung | Werte | Voreinstellung |
|---|---|---|
| Sperrzeit ohne Bedienung | 1–30 Minuten | 2 |
| Vormerkungen am Tablet zeigen | an/aus | aus |
| Künftige Kinder mit Vertrag am Tablet zeigen | an/aus | aus |

Hinweistext: „Mitarbeiter sehen Kinder nur am Tablet: Name antippen und PIN eingeben. Das Tablet sperrt sich nach der
Sperrzeit ohne Bedienung von selbst.“

## 8. Technik

### 8.1 Datenmodell (eine Migration, nächste Nummer nach 0031)

- `facilities`: `tablet_lock_minutes` (integer, not null, default 2), `tablet_show_waitlist` (boolean, default
  false), `tablet_show_future_contracts` (boolean, default false).
- Neue Tabelle `terminal_unlocks`: `id` (text, zufälliges Kennzeichen, Primärschlüssel), `terminal_user_id` (→ users,
  cascade, unique – höchstens ein Aufschließen pro Gerätekonto, siehe unten), `facility_id` (→ facilities,
  cascade), `employee_id` (→ employees, cascade), `created_at`, `last_active_at` (ISO-Zeitpunkte).
  - Die Sitzung des Tablets speichert das Kennzeichen (`childUnlock`). Gilt nur, wenn Kennzeichen, Gerätekonto und
    Einrichtung zusammenpassen.
  - Sperren löscht die Zeile; ein neues Aufschließen ersetzt sie. Abgelaufene Zeilen werden beim nächsten
    Aufschließen und im täglichen Lauf gelöscht.
  - `unique(terminal_user_id)` bedeutet: Schließt an einem zweiten Gerät mit demselben Gerätekonto jemand auf, endet
    das Aufschließen am ersten Gerät. Das ist gewollt (höchstens eine aufgeschlossene Person je Gerätekonto).

### 8.2 Server

- **PIN-Prüfung**: Die Prüfung aus `terminalStamp` (Fehlversuche, Sperre 15 Minuten) wird eine gemeinsame Funktion
  für Stempeln und Aufschließen. Wer aufschließen darf, bestimmt dieselbe Auswahl wie `terminalStatus`.
- **Neue Tablet-Routen** (`requireTerminal(`):
  - `POST /api/terminal/children/unlock` `{ employeeId, pin }` → aufschließende Person (Name, Rechte) und Sperrzeit.
  - `POST /api/terminal/children/lock`.
  - `POST /api/terminal/children/keep-alive` → verlängert, solange am Tablet bedient wird (das Tablet sendet höchstens
    alle 30 Sekunden, und nur nach Bedienung).
  - `GET /api/terminal/children/status` → aufgeschlossen ja/nein, Person, Rechte, verbleibende Zeit.
- **Wer sieht Kinder** (`server/utils/auth.ts`): Eine Funktion ermittelt den **Kinder-Betrachter** einer Anfrage:
  - Leitung/Träger mit eigenem Konto → wie bisher;
  - Mitarbeiter mit eigenem Konto → 403 `children_tablet_only`;
  - Tablet → nur mit gültigem Aufschließen (sonst 403 `tablet_locked`); Rechte nach 4.1, Einrichtung = die des
    Tablets, Merkmal „am Tablet“ für 5.1 und 6. Jede erfolgreiche Anfrage setzt `last_active_at`.
  - `requireChildReader(` und `requireChildEditor(` nutzen diese Funktion. Neu: `requireChildManager(` für die
    Kinderrouten, die heute `requireAdmin(` prüfen (Kind löschen, Archiv, Belegung, Gruppenwechsel planen/ändern/
    löschen, Abmelden, Abmeldung zurücknehmen, Schulkinder-Liste) – Leitung/Träger im Büro oder am Tablet.
  - Die Services bekommen den Kinder-Betrachter statt des Sitzungsbenutzers (Konto-Kennung für „hochgeladen von“ ist
    leer bei Personen ohne Konto; diese dürfen ohnehin nichts ändern).
- **Sichtbarkeit 5.1** wird in den Services durchgesetzt (Listen, Geburtstage, Dokumentübersicht, Offen, Akte,
  Dateien), nicht nur in der Oberfläche.
- **Einstellungen**: `GET/PUT /api/tablet-settings` (`requireAdmin(`), Prüfung 1–30 Minuten.
- **Berechtigungstest** (`tests/api/permissions.test.ts`): neue Liste für `requireChildManager(`, die neuen Tablet-
  und Einstellungsrouten; die Beschreibungen der Listen werden angepasst („not the tablet“ entfällt).

### 8.3 Oberfläche

- **Seitenschutz** (`app/middleware/auth.global.ts`): Das Tablet darf zusätzlich `/children` und `/children/…`;
  Mitarbeiter-Konten werden von `/children…` zur Startseite geleitet.
- **Menü** (`app/layouts/default.vue`): „Kinder“ nur für Leitung und Träger; am Tablet ersetzt der Balken
  „Aufgeschlossen: ‹Name› · Sperren“ das Menü, solange eine Kinderseite offen ist.
- **Rechte in den Kinderseiten**: Die Seiten fragen die Rechte über einen gemeinsamen Baustein ab (Konto im Büro,
  aufschließende Person am Tablet) statt direkt über das angemeldete Konto.
- **Sperr-Zeitgeber** am Tablet: zählt die Sperrzeit ab der letzten Bedienung herunter, sendet `keep-alive` nach
  Bedienung, sperrt bei Ablauf (`lock`) und springt zur Startseite. Jede Antwort `tablet_locked` führt ebenfalls zur
  Startseite.
- **Dokument-Anzeige**: PDFs mit `pdfjs-dist` (neue, reine JavaScript-Abhängigkeit) auf Zeichenflächen; Fotos aus
  dem Arbeitsspeicher. Kein Link auf die Datei-Adresse.
- **„Foto aufnehmen“**: Dateiauswahl mit Kamera (`capture`), dieselben Prüfungen wie beim Hochladen.
- Das Ziffernfeld der PIN wird ein gemeinsamer Baustein für Stempeln und Aufschließen.
- Neue deutsche Texte in `app/locales/de.ts` (Fehler `children_tablet_only`, `tablet_locked`,
  `tablet_lock_minutes_invalid`).

## 9. Fehlerfälle

| Fall | Verhalten |
|---|---|
| Mitarbeiter ruft eine Kinderseite auf dem Handy auf | Umleitung zur Startseite; Server 403 `children_tablet_only` |
| Sperrzeit abgelaufen, jemand tippt am Tablet | Server 403 `tablet_locked` → Startseite |
| Falsche PIN | wie beim Stempeln („PIN falsch“, nach 5 Versuchen 15 Minuten gesperrt) |
| Freischaltung wird entzogen, während die Person aufgeschlossen ist | nächste Bearbeitung wird abgelehnt; Lesen geht weiter |
| Aushilfe ist heute nicht mehr eingeplant (Einsatz gelöscht) | Aufschließen endet bei der nächsten Anfrage |
| Kind wird per Schalter ausgeblendet, während seine Akte am Tablet offen ist | nächste Anfrage 404 → zurück zur Liste |
| Akte ist offen, Gerät legt sich schlafen | beim Aufwachen ist die Sperrzeit abgelaufen → Startseite |

## 10. Tests

- **Server (Vitest)**:
  - Mitarbeiter-Konto (mit und ohne Freischaltung) bekommt bei jeder Kinderroute 403 `children_tablet_only`; Leitung
    und Träger unverändert.
  - Tablet ohne Aufschließen, nach Sperren, nach Ablauf der Sperrzeit (geänderte Sperrzeit wirkt sofort) → 403
    `tablet_locked`; `keep-alive` verlängert.
  - Rechte nach 4.1: ohne Konto lesen; Freischaltung bearbeiten; Leitung am Tablet Belegung/Archiv; Aushilfe nur an
    Einsatztagen und nur lesen; deaktiviertes Konto nur lesen; entzogene Freischaltung wirkt sofort; Einstellungen
    und Einrichtungswechsel am Tablet abgelehnt.
  - PIN-Fehlversuche gemeinsam mit dem Stempeln; zweites Aufschließen ersetzt das erste.
  - Schalter 5.1 in allen Listen und beim direkten Aufruf (Akte, Dokumentdatei) → 404 für Personen ohne
    Leitungsrechte; Leitung am Tablet sieht die Kinder weiterhin.
  - „Hochgeladen von“ am Tablet = Konto der aufschließenden Person.
  - Berechtigungstest für alle Routen.
- **Oberfläche**: Zusätzlich zu den automatischen Tests klickt der Umsetzer die Tablet-Seiten selbst im Browser durch,
  in Tablet-Größe: Aufschließen, Lesen, Bearbeiten, Foto hochladen, PDF anzeigen, Sperren durch Zeit und Knopf,
  Mitarbeiter-Konto ohne „Kinder“.

## 11. Betrieb

`docs/BETRIEB.md`, Abschnitt „Datenschutz (Kinderakten)“: Kinder für Mitarbeiter nur am Tablet; Sperrzeit und die
beiden Schalter; Hinweis, dass Mitarbeiter für den Zugang eine PIN brauchen (vergibt die Leitung wie fürs Stempeln).

## 12. Für spätere Stufen festgehalten (nicht Teil dieses Umbaus)

- **Stufe 2 – Anwesenheit der Kinder** (am Tablet): Ein- und Ausstempeln der Kinder; Bringperson freiwillig,
  Abholperson beim Abholen Pflicht, geplante Abholzeit beim Bringen; Snack und Mittagessen pro Tag. Die
  Anwesenheitsliste muss **ausdruckbar** sein, digital wie im Ausdruck mit den Spalten **geplante Abholzeit** und
  **Abholperson**. Vorlage: Blatt „Anwesenheit Kinder“ (Monat, Zeile pro Kind, Spalte pro Tag, „Bemerkung“). Da
  Abholzeit und Abholperson pro Tag nicht in ein Monatsraster passen, voraussichtlich eine Tagesliste (Ankunft,
  geplante Abholzeit, Abholperson, tatsächliche Abholung) zusätzlich zur Monatsübersicht – in Stufe 2 festzulegen.
- **Stufe 3 – Wochenplanung / Tagesprotokoll** (am Tablet): Mitarbeiter tragen für jeden einzelnen Tag ein, was sie
  an dem Tag gemacht haben; **das darf jeder Mitarbeiter**. Vorlage: Blatt „Wochenübersicht“ („Liste mit Spalten,
  was an dem Tag gemacht wurde“).
- Danach bzw. davor nach Wunsch: Bundesland pro Einrichtung und Feiertage je Bundesland.

## 13. Nicht enthalten

- Protokoll, wer wann welche Akte angesehen hat.
- Verhindern von Bildschirmfotos.
- Mehrere gleichzeitig aufgeschlossene Personen am selben Tablet.
- Ausdrucke aus der Kinderakte am Tablet.
