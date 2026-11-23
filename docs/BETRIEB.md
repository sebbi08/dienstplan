# Dienstplan – Betrieb auf dem Server

Diese Anleitung beschreibt, wie der Dienstplan auf einem eigenen Server läuft.
Du brauchst dafür einen Linux-Server mit installiertem **Docker** (inklusive „Docker Compose“).

## 1. Dateien auf den Server bringen

Kopiere den kompletten Projektordner auf den Server, z. B. nach `/opt/dienstplan`.

## 2. Einstellungen festlegen

1. Kopiere `deploy/.env.example` nach `/opt/dienstplan/.env`.
2. Trage ein:
   - `NUXT_APP_SECRET`: mindestens 32 zufällige Zeichen (z. B. mit `openssl rand -base64 32` oder aus einem Passwort-Manager).
   - `ADMIN_USERNAME` und `ADMIN_PASSWORD`: Zugang für die erste Anmeldung. Das Passwort muss beim ersten Login geändert werden.
   - `DOMAIN`: die Internetadresse, unter der der Dienstplan erreichbar sein soll.

## 3. Starten

```bash
cd /opt/dienstplan
docker compose --profile https up -d --build
```

Danach ist der Dienstplan unter `https://<DOMAIN>` erreichbar. Das HTTPS-Zertifikat holt Caddy automatisch.
Voraussetzung: Die Domain zeigt auf den Server, und die Ports 80 und 443 sind offen.

Ohne HTTPS nur im lokalen Netz: Trage in der Datei `.env` diese zwei Zeilen ein
(`docker-compose.yml` bleibt unverändert) und starte nur mit `docker compose up -d --build`:

```
BIND_ADDRESS=0.0.0.0
NUXT_SESSION_COOKIE_SECURE=false
```

Danach ist der Dienstplan im lokalen Netz unter `http://<Server-Adresse>:3000` erreichbar.

Lege außerdem gleich nach der Einrichtung unter *Benutzer* einen zweiten Admin-Zugang an
(z. B. für eine Stellvertretung). So kommst du auch dann wieder hinein, wenn ein Passwort verloren geht.

## 4. Update auf eine neue Version

```bash
cd /opt/dienstplan
# neue Projektdateien hierher kopieren, dann:
docker compose --profile https up -d --build
```

Die Daten bleiben erhalten; die Datenbank wird beim Start automatisch auf die neue Version gebracht.
Ausnahme: Mit dem Update auf die 6-stellige Stempel-PIN werden alle bisherigen PINs gelöscht und müssen neu gesetzt
werden (siehe Abschnitt 15, „Stempel-PIN“).

Löschfristen: Die App löscht nach einem Update **nichts von selbst** – auch nicht die Daten von Personen, die vor
Jahren ausgeschieden sind, oder alte Kinderakten. Was nach Ablauf einer Frist gelöscht werden darf, steht für den
Träger unter **Mehr → Löschfristen**; dort löscht er von Hand (siehe „Löschfristen“ in Abschnitt 15). Setz vorher bei
Stundenkonto-Buchungen über ausgezahlte Überstunden das Häkchen **„ausgezahlt“** (Seite der Person → Stunden &
Vertrag → Stundenkonto-Buchungen): Nur dann gilt für sie die längere Frist (voreingestellt 8 Jahre).

## 5. Datensicherung

- **Automatisch:** Die App legt jede Nacht eine Kopie der Datenbank im Datenbereich im Ordner `backups`
  ab (Dateiname `app-JJJJ-MM-TT.db`) und behält die letzten 14 Tage.
- **Von Hand:** In der App unter *Einstellungen → Einrichtung → Datensicherung → Datenbank herunterladen*
  (Dateiname `dienstplan-JJJJ-MM-TT.db`).
- **Sicherungen vom Server holen** (z. B. auf einen anderen Rechner kopieren). Erst den Zielordner
  anlegen, dann den Inhalt des Server-Ordners hineinkopieren (der Punkt am Ende ist wichtig):

  ```bash
  mkdir -p backups
  docker compose cp dienstplan:/data/backups/. ./backups/
  ```

Bewahre Sicherungen immer auch außerhalb des Servers auf.

Seit es die Kinderakten gibt, liegen auch alle Kinderdaten und hochgeladenen Dokumente (PDF, Fotos) in der
Datenbank. Die Datenbank und damit jede Sicherung ist deshalb größer als früher und enthält sensible
Daten. Behandle jede Sicherung wie die Kinderakten selbst (siehe Abschnitt 8).

## 6. Wiederherstellen einer Sicherung

Gehe dafür in den Projektordner (`cd /opt/dienstplan`) und führe diese vier Schritte nacheinander aus.
Ersetze `dienstplan-2026-10-05.db` durch den Namen deiner Sicherungsdatei. Das kann eine von Hand
heruntergeladene Datei sein (`dienstplan-JJJJ-MM-TT.db`) oder eine automatische Nachtsicherung aus dem
Ordner `backups` (`app-JJJJ-MM-TT.db`, siehe Abschnitt 5).

1. Dienstplan anhalten:

   ```bash
   docker compose stop dienstplan
   ```

2. Sicherung an die Stelle der Datenbank kopieren:

   ```bash
   docker compose cp ./dienstplan-2026-10-05.db dienstplan:/data/app.db
   ```

3. Alte Zwischendateien entfernen und die Zugriffsrechte richtig setzen:

   ```bash
   docker compose run --rm --user root --entrypoint sh dienstplan -c "rm -f /data/app.db-wal /data/app.db-shm && chown node:node /data/app.db"
   ```

4. Dienstplan wieder starten:

   ```bash
   docker compose start dienstplan
   ```

Warum Schritt 3 wichtig ist: Die Datenbank legt neben `app.db` kurzzeitig Zwischendateien an.
Bleiben die alten Zwischendateien liegen, vermischen sie sich mit der wiederhergestellten Sicherung und
die Daten werden falsch oder unbrauchbar. Außerdem gehört die kopierte Datei sonst dem falschen Benutzer,
und die App kann nicht mehr in die Datenbank schreiben.

## 7. Passwort des einzigen Admins vergessen

Ein anderer Admin kann unter *Benutzer* das Passwort zurücksetzen. Gibt es keinen weiteren Admin
(Tipp: Lege bei der Einrichtung immer einen zweiten Admin-Zugang an), gehe so vor:

1. Öffne die Datei `.env` im Projektordner. Achte darauf, dass `ADMIN_USERNAME` der Name des betroffenen
   Admins ist, und füge diese Zeile hinzu (mindestens 8 Zeichen):

   ```
   ADMIN_RESET_PASSWORD=<neues Passwort>
   ```

2. Starte den Dienstplan neu:

   ```bash
   docker compose up -d
   ```

3. Melde dich mit dem neuen Passwort an. Die App verlangt sofort ein eigenes neues Passwort.
4. Lösche die Zeile `ADMIN_RESET_PASSWORD=…` wieder aus der Datei `.env` und starte noch einmal
   mit `docker compose up -d`.

## 8. Datenschutz (Kinderakten)

### Was gespeichert wird

Die Kinderakten (Stammdaten, Notizen, Kontakte usw.) und alle hochgeladenen Dokumente liegen in der
Datenbank des Dienstplans (im Docker-Betrieb die Datei `/data/app.db`). Erlaubt sind PDF-, JPG- und
PNG-Dateien bis 30 MB pro Dokument. Es gibt keinen separaten Ordner mit Dokumenten: Wer die
Datenbank hat, hat alles.

**Größe hochgeladener Dateien (30 MB, seit 23.11.2026; vorher 10 MB):** Das gilt für jede hochgeladene Datei – Kinder- und
Personalakte, Vorlagen, Wissen, Dokumente des Gesundheitsamts, Attest der Wiederzulassung, Anhänge der Unfallanzeigen,
Kassenbelege und ausgefüllte PDFs (nur die Straßenliste der Schulbezirke: 10 MB). Die App prüft die Größe schon beim
Auswählen („Die Datei ist zu groß (31,2 MB). Erlaubt sind höchstens 30 MB.“), der Server noch einmal, bevor er die
Datei annimmt. Er liest eine Hochladung genau einmal in den Speicher: eine 30-MB-Datei belegt etwa 30 MB, nicht ein
Vielfaches (wichtig für den Container mit 1024 MB). Große Dateien machen die Datenbank und damit **jede Sicherung**
größer: zehn Dokumente à 30 MB sind 300 MB mehr in `app.db`, in jeder Sicherung unter `/data/backups` und im Download
„Datensicherung“ – bitte den freien Speicherplatz des Servers im Blick behalten. Beim Speichern wächst kurz auch die
Datei `app.db-wal` um die Größe der Datei. Gelöschte Dokumente werden überschrieben (secure_delete); der Platz in der
Datenbank wird wiederverwendet, die Datei selbst wird aber nicht kleiner.

**Dokumentart „Nachweis ärztliche Impfberatung (§ 34 Abs. 10a IfSG)“:** Vor der ersten Aufnahme in eine Kita weisen die
Eltern schriftlich nach, dass sie zeitnah ärztlich zum Impfschutz des Kindes beraten wurden; fehlt der Nachweis,
benachrichtigt die Leitung das Gesundheitsamt. Dafür gibt es diese Dokumentart in jeder Einrichtung (beim Update dazu
gekommen, wo es noch keine Art mit diesem Namen gab). Sie ist „wichtig“ (erscheint in der Dokumentenübersicht), aber
nicht „für jedes Kind nötig“ – Kinder, die schon vorher aufgenommen wurden, brauchen keinen. Wer sie für neue Kinder rot
markiert haben will, setzt in den Einstellungen „für jedes Kind nötig“. Die App blockiert nichts. Quelle: § 34 Abs. 10a
IfSG; Stand 19.11.2026.

### Einwilligungen

Die Einwilligungen in der Akte (ja / nein / offen) sind in Blöcke geteilt: **„Datenschutz“**, **„Messenger
(WhatsApp, Signal)“** mit „Kontaktaufnahme über WhatsApp“, „Fotos über WhatsApp versenden“, **„Fotos über Signal
versenden“** und „WhatsApp-Elterngruppe“, und **„Gesundheit“** mit „Fieber messen“, „Sonnenschutz auftragen“,
„Pflaster kleben“ und **„Darf mit Insektenschutz eingesprüht werden“**. Bei „nein“ zum Insektenschutz steht in der
Anwesenheitsliste (und im Ausdruck) „kein Insektenschutz“ – auch wenn die Einrichtung die Frage umbenennt oder
ausblendet. Früher gab es „Fotos über WhatsApp versenden“ zweimal (auch unter Datenschutz); die beiden Werte wurden
zusammengeführt: war einer offen, gilt der andere; widersprachen sich ja und nein, gilt **nein**.

**Eigene Fragen je Einrichtung.** Die Fragen sind seit diesem Update Sache der Einrichtung: Unter *Einstellungen →
Kinder → Einwilligungen & Erlaubnisse* ändert die Leitung (wer die Kinder-Einstellungen ändern darf) Text, Kurzname
(die Spaltenüberschrift in der Übersicht) und Bereich, legt neue Fragen und Bereiche an, ordnet sie und blendet sie
aus. Löschen lässt sich nur eine Frage, die noch kein Kind beantwortet hat; sonst nur **ausblenden** – die Antworten
bleiben als Nachweis und stehen in der Akte unter „ausgeblendete Fragen“. Dort lässt sich eine Einwilligung noch
widerrufen („nein“) oder die Antwort löschen („offen“), z. B. wenn Eltern widerrufen (Art. 7 Abs. 3 DSGVO); ein neues
„ja“ gibt es erst, wenn die Leitung die Frage wieder einblendet. Die drei Erlaubnisse „Fieber
messen“, „Sonnenschutz auftragen“ und „Pflaster kleben“ standen früher im Abschnitt „Gesundheit“ der Akte; sie sind
jetzt Fragen im Bereich „Gesundheit“ der Einwilligungen (nach einem Gruppenwechsel also mit „Einwilligungen“ zu
bestätigen, nicht mehr mit „Gesundheit“). Beim Update bekam jede Einrichtung genau die bisherigen 14 Fragen, und jede
Antwort (ja / nein) wurde übernommen; neue Einrichtungen beginnen mit denselben Fragen. Zieht ein Kind in eine andere
Einrichtung um, gehen seine Antworten mit: zur Frage dort mit demselben Ursprung, solange sie dort noch dasselbe fragt
(gleicher Text), sonst zur Frage mit demselben Text; gibt es keine, wird die Frage dort ausgeblendet angelegt, damit
die Antwort erhalten bleibt. Nur die Frage zum Insektenschutz geht immer zur Insektenschutz-Frage der neuen
Einrichtung, auch wenn sie dort anders heißt.

**Reiter der Übersicht.** Welche Reiter *Kinder → Übersicht* hat und welche Spalten jeder zeigt, legt die Leitung
unter *Einstellungen → Kinder → Reiter der Übersicht* fest: Reiter anlegen, umbenennen, ordnen, löschen; je Reiter
Spalten aus den Fragen (nach Bereich) und den festen Feldern der Akte wählen und ordnen (Geburtsdatum, Gruppe,
Adresse, künftige Schule, Masernnachweis, Belehrung, Allergien, Abholberechtigte, Sorgeberechtigte, Kontaktverbote,
Anruf-Reihenfolge, Telefonnummern, Elterngespräche). Nach dem Update hat jede Einrichtung die bisherigen acht Reiter
mit denselben Spalten – die Übersicht sieht aus wie vorher. Löscht eine Einrichtung alle Reiter, zeigt die Übersicht
nur einen Hinweis.

*Für den Betrieb:* Die alten Spalten der Einwilligungen in der Tabelle `children` (`consent_*`, `may_take_temperature`,
`may_apply_sunscreen`, `may_apply_plaster`) liest und schreibt die App seit der Migration 0111 nicht mehr; sie bleiben
nur, damit ein Zurück auf die Vorversion möglich ist (die dann den Stand vom Update zeigt). Nach einem Zurück und
erneutem Update gelten wieder die Antworten aus der App; Änderungen in der Zwischenzeit (in der Vorversion) gehen
verloren, weil die Migration 0111 dann schon gelaufen ist und nicht noch einmal kopiert. Die alten Spalten werden in
einer späteren Version entfernt.

### Wer sieht was

| Rolle | Kinderakten |
|---|---|
| Träger und Leitung | sehen alles in ihrer (gewählten) Einrichtung: alle Kinder, auch vertrauliche Dokumente. Nur sie dürfen ein Kind abmelden, das Archiv sehen und eine Vormerkung löschen. Eine **archivierte** Akte löscht nur der Träger (siehe „Löschen nach der Aufbewahrungsfrist“). Das gilt im Büro und am Tablet. |
| Mitarbeiter | sehen die Kinder **nur am Tablet der eigenen Einrichtung**, und dort nur lesend: alle aktiven Kinder, Vormerkungen und künftige Vertragskinder nur, wenn die Schalter (siehe unten) an sind. Vertrauliche Dokumente öffnen sie nicht (Art und Datum sehen sie, den Titel nicht), und abgemeldete Kinder (Archiv) sehen sie nicht. Mit dem eigenen Konto (Handy, privater PC) sehen sie keine Kinder. Beobachtungsbögen und Entwicklungsgespräche der Kinder ihrer Gruppe legen sie am Tablet an und füllen sie aus (Abschnitt 25). |
| Mitarbeiter mit dem Recht „eintragen und Akten ändern“ (früher „darf Kinderakten pflegen“) | dürfen am Tablet zusätzlich Kinder anlegen und bearbeiten, Dokumente hochladen und vertrauliche Dokumente öffnen. Abmelden, Archiv und Löschen bleiben der Leitung und dem Träger vorbehalten. |
| Gruppenleitung | darf in der Grundeinstellung dasselbe wie ein Mitarbeiter mit „eintragen und Akten ändern“ (eigene Gruppe) – und das auch **mit dem eigenen Konto** im Büro, nicht nur am Tablet. Vormerkungen und künftige Vertragskinder sieht sie wie am Tablet nur, wenn die Tablet-Schalter an sind (außer der Träger gibt ihr „Kinder: verwalten“). Siehe Abschnitt 26. |
| Aushilfen aus einer anderen Einrichtung | sehen die Kinder am Tablet nur an den Tagen, an denen sie dort eingeplant sind, und nur lesend. Beobachtungsbögen lesen sie nur (außer als Bezugserzieher oder für einen Bogen freigeschaltet, Abschnitt 25). |

Das Recht „eintragen und Akten ändern“ gibt die Leitung oder der Träger bei der Person (*Mitarbeiter → Name → Zugang*,
oder *Benutzer* → „Rechte“). Es gilt am Tablet der Einrichtung. Was die Rollen sonst dürfen, stellt der Träger unter
*Mehr → Rechte und Rollen* ein (Abschnitt 26); die Tabelle oben beschreibt die Grundeinstellung.

Mitarbeiter **mit einer Gruppe** sehen am Tablet nur die Akten ihrer eigenen Gruppe (und der Gruppen, die für sie
freigeschaltet sind, nur lesend) – siehe Abschnitt 12.

### Kinder am Tablet

- Auf der Startseite des Tablets gibt es drei Knöpfe: **Stempeln**, **Kinder** und **Vorlagen** (siehe Abschnitt 19).
  Unter „Kinder“ tippt die Person ihren Namen an und gibt ihre PIN ein; danach ist das Tablet für sie **aufgeschlossen**. Oben steht
  „Aufgeschlossen: ‹Name›“ mit dem Knopf **Sperren**.
- Für den Zugang braucht jeder Mitarbeiter eine **PIN**. Die vergibt die Leitung wie fürs Stempeln (unter
  *Mitarbeiter*). Auch wer kein eigenes Benutzerkonto hat, kann mit der PIN aufschließen (nur lesen). Die PIN hat
  6 Ziffern; nach falschen Eingaben wird sie gesperrt – beim Stempeln und beim Aufschließen gleich (siehe Abschnitt 15,
  „Stempel-PIN“).
- Das Tablet sperrt sich wieder, wenn die **Sperrzeit** ohne Bedienung abgelaufen ist, wenn jemand „Sperren“
  antippt, die Kinderseiten verlässt (zur Startseite, zum Stempeln oder zum Dienstplan) oder eine andere Person
  aufschließt. Das merkt das Tablet spätestens nach einer halben Minute auch von selbst, z. B. wenn die Sperrzeit
  verkürzt oder der Person die PIN gelöscht wurde.
- Unter *Einstellungen → Einrichtung → Tablet* stellen Leitung und Träger pro Einrichtung ein:
  - die **Sperrzeit ohne Bedienung** (1 bis 30 Minuten, voreingestellt 2 Minuten),
  - **Vormerkungen am Tablet zeigen** (voreingestellt aus),
  - **Künftige Kinder mit Vertrag am Tablet zeigen** (voreingestellt aus; aus heißt: ein Kind mit Vertrag
    erscheint erst ab seinem Eintrittstag).

  Die beiden Schalter gelten für alle ohne Leitungsrechte; Leitung und Träger sehen immer alle Kinder.
- Dokumente öffnen sich am Tablet in einer Anzeige **innerhalb der App** (PDFs Seite für Seite, Fotos als Bild).
  Es gibt am Tablet kein Herunterladen, damit keine Datei auf dem Gerät liegen bleibt. Ein Bildschirmfoto kann
  die App allerdings nicht verhindern.
- **Fotos mit „Foto aufnehmen“:** Manche Kamera-Apps (vor allem auf Android) legen von jedem Foto, das du für
  ein Dokument aufnimmst, zusätzlich eine Kopie in der Galerie des Tablets ab. Prüfe deshalb einmal, ob die
  Kamera-App deines Tablets das tut: Foto für ein Dokument aufnehmen, hochladen, danach in der Galerie
  nachsehen. Liegt dort eine Kopie, lösch sie (und schau auch in den Papierkorb der Galerie, dort bleibt sie
  sonst noch einige Tage).
- Einstellungen und das Verschieben eines Kindes in eine andere Einrichtung gibt es am Tablet nicht – auch nicht
  für Leitung und Träger.

### Aufbau der Seite *Kinder*

Oben stehen drei große Knöpfe, die **Bereiche**; darunter die kleinen Reiter des gewählten Bereichs:

| Bereich | Reiter | Wer |
|---|---|---|
| **Heute** | Anwesenheit, Wochenübersicht – oben im Bereich der Kasten „Erinnerungen“ | alle |
| **Kinder** | Liste, Übersicht, Geburtstage, Dokumente, Offen – für Mitarbeiter am Tablet dahinter „Vormerkungen & Verträge“, wenn ein Schalter es erlaubt | alle |
| **Planung** | Vormerkungen & Verträge, Belegung, Personalschlüssel, Archiv | nur Leitung und Träger, im Büro und am Tablet |

- Die Reiter haben ihre bisherigen Regeln: „Personalschlüssel“ gibt es nicht am Tablet. Mitarbeiter sehen den
  Bereich „Planung“ nie. **„Vormerkungen & Verträge“** sehen sie am Tablet als letzten Reiter unter **„Kinder“** (nach
  „Offen“) – aber nur, wenn unter *Einstellungen → Einrichtung → Tablet* „Vormerkungen am Tablet zeigen“ oder „Künftige Kinder mit
  Vertrag am Tablet zeigen“ an ist; sind beide aus, gibt es den Reiter für sie nicht. Leitung und Träger finden ihn
  immer unter „Planung“.
- Die Seite öffnet mit **Heute → Anwesenheit**. Das Gerät merkt sich den zuletzt benutzten Reiter (auch je Bereich)
  und öffnet beim nächsten Mal wieder dort – wenn die Person ihn sehen darf, sonst wieder mit „Anwesenheit“.
- **„Kind anlegen“** steht oben rechts neben der Überschrift (für alle, die Kinder anlegen dürfen).
- Mit der Tastatur wechselst du mit den Pfeiltasten zwischen den Bereichen bzw. Reitern.
- Die **Liste** und die **Übersicht** stehen nach Gruppen und darin nach Alter: das älteste Kind zuerst, bei gleichem
  Geburtstag nach Nachname.
- Daten in der Kinderakte tippst du als **TT.MM.JJJJ** (z. B. „03052021“ – die Punkte kommen von selbst); der
  Kalender-Knopf im Feld öffnet weiterhin den Kalender. Ein ungültiges Datum wird rot markiert und nicht gespeichert.

### Bezugspersonen und Anruf-Reihenfolge

- In der Akte stehen die Bezugspersonen in der Reihenfolge, die du mit den Pfeilen **nach oben / nach unten**
  festlegst.
- **„Anrufen als Nr.“** (1 = zuerst anrufen) sagt, wen ihr im Notfall in welcher Reihenfolge anruft. Das gilt für
  jede Bezugsperson: bei den Eltern (alle mit „sorgeberechtigt“), wer von ihnen zuerst angerufen wird, bei den anderen
  ihre Reihenfolge als Notfallkontakt. Wer ein Kontaktverbot hat, bekommt keine Nummer.
- Der Kasten **„Wichtig“** oben in der Akte („Anruf-Reihenfolge“), die Übersichten **„Anruf-Reihenfolge“** und
  **„Telefonnummern“** und ihre Ausdrucke zeigen die Bezugspersonen in dieser Reihenfolge: zuerst die Eltern nach
  „Anrufen als Nr.“ (Eltern ohne Nummer danach, in der Reihenfolge der Akte), dann die anderen mit Nummer, nach
  Nummer. Bei gleicher Nummer zählt die Reihenfolge der Akte.
- Nur in den **Telefonnummern** folgen danach die übrigen Bezugspersonen ohne Nummer (in der Reihenfolge der Akte)
  und ganz am Ende die Bezugspersonen mit **Kontaktverbot** – rot und mit „– Kontaktverbot“ hinter dem Namen. Im
  Kasten „Wichtig“ und in der Anruf-Reihenfolge stehen sie nie.

### Elterngespräche

- In der Kinderakte steht der Abschnitt **„Elterngespräche“**: alle Gespräche, das neueste oben, je Eintrag Datum,
  Uhrzeit (von – bis), Art und Teilnehmer, darunter klein „eingetragen von … am …“ (nach einer Änderung „geändert
  von … am …“). Gespräche in der Zukunft tragen den Zusatz **„geplant“** – auch eines heute, solange es noch nicht
  begonnen hat.
- **Wer einträgt:** wer die Akte bearbeiten darf – Leitung und Träger, am Tablet auch Mitarbeiter mit „darf
  Kinderakten pflegen“ (Mitarbeiter mit Gruppe für die eigene Gruppe, nicht für Gruppen, die für sie nur zum Lesen
  freigeschaltet sind). Mit **„Gespräch eintragen“** gibst du Datum (voreingestellt heute), Uhrzeit von, bis
  (freiwillig), Art (Entwicklungsgespräch, Eingewöhnung, Abschlussgespräch, Sonstiges) und Teilnehmer ein; mit
  **„Ändern“** und dem Papierkorb (mit Rückfrage) änderst bzw. löschst du ein Gespräch. Wer es eingetragen oder
  zuletzt geändert hat (am Tablet die aufschließende Person, auch ohne eigenes Konto), steht beim Eintrag. Bei
  einem ausgetretenen Kind lässt sich nichts mehr ändern.
- **Vertrauliche Notiz:** Zu jedem Gespräch können **nur Leitung und Träger** eine Notiz schreiben und lesen.
  Mitarbeiter sehen Datum, Uhrzeit, Art und Teilnehmer, aber nie die Notiz – sie wird gar nicht erst an ihr Gerät
  geschickt. Ändert ein Mitarbeiter ein Gespräch, bleibt die Notiz der Leitung unverändert.
- **Übersicht:** Unter *Kinder → Übersicht* zeigt der Unterreiter **„Elterngespräche“** je Kind das letzte Gespräch,
  das nächste geplante, alle Gespräche (neueste zuerst) und ihre Anzahl – ohne Notizen und ohne Teilnehmer (siehe
  Abschnitt 14).
- **Erinnerung:** Am Tag eines Gesprächs steht es den ganzen Tag im Kasten „Erinnerungen“, z. B. „Elterngespräch
  Lena Muster heute 14:00 (Entwicklungsgespräch)“. „Erledigt“ gibt es dafür nicht: am nächsten Tag ist die
  Erinnerung weg, das Gespräch bleibt in der Akte (siehe Abschnitt 16). Das gilt auch für Kinder, die noch nicht
  angefangen haben (Vertragskinder vor dem Eintritt und Vormerkungen).

### Löschen nach der Aufbewahrungsfrist

- Wird ein Kind abgemeldet, kommt die Akte ins Archiv. Dort steht bei jedem Kind, ab wann seine Akte gelöscht
  werden darf („löschbar ab …“).
- Die App löscht **nichts von selbst**. Ist die Frist abgelaufen, löscht der **Träger** die Akte samt Dokumenten
  unter **Mehr → Löschfristen** (siehe Abschnitt 15, „Löschfristen“). Er bekommt dazu eine Erinnerung.
- Im Archiv hat nur der **Träger** den Knopf **„Sofort löschen“**. Er beachtet die Frist **nicht** – nur für
  Fehleinträge. Die Leitung löscht keine archivierte Akte; sie kann die Abmeldung aber zurücknehmen.
- Die Frist stellt der Träger unter *Einstellungen → Einrichtung* ein: „Löschfrist für abgemeldete Kinder“,
  1 bis 10 Jahre, voreingestellt sind **3 Jahre**.
- Besprich die Frist mit dem/der Datenschutzbeauftragten, bevor du sie festlegst.
- **Unfallanzeigen bleiben 5 Jahre ab dem Unfall.** Erste-Hilfe-Leistungen sind 5 Jahre lang aufzubewahren (DGUV
  Vorschrift 1 § 24 Abs. 6; die DGUV Information 202-089 „Erste Hilfe in Kindertageseinrichtungen“ rät: „fünf Jahre
  (besser 10 Jahre)“). Die Unfallanzeigen eines Kindes hängen an seiner Akte. Ist die jüngste Unfallanzeige zum Ende
  der Löschfrist noch keine 5 Jahre alt, darf die Akte erst 5 Jahre nach diesem Unfall gelöscht werden. Archiv,
  Kinderakte und „Schulkinder“ nennen dann diesen späteren Tag; unter Mehr → Löschfristen steht an der Zeile
  „(Unfallanzeigen bleiben 5 Jahre ab dem Unfall)“. Als Unfalltag zählt das „Datum“ der Unfallanzeige, sonst der Tag,
  an dem sie angelegt wurde. „Sofort löschen“ im Archiv (nur Träger, für Fehleinträge) beachtet auch diese Frist nicht;
  gehören zur Akte noch Unfallanzeigen innerhalb der 5 Jahre, fragt die App ein zweites Mal („Achtung: Zur Akte von …
  gehören … Unfallanzeigen …“, Knopf **„Trotzdem löschen“**). Die Akte eines Kindes, das schon betreut wird, lässt sich
  nicht direkt löschen (nur über Abmelden und das Archiv); eine Vormerkung oder ein Kind, dessen Vertrag noch nicht
  begonnen hat, nur, solange es zu ihm keine Unfallanzeige gibt.
  Quelle: DGUV Vorschrift 1 § 24 Abs. 6, DGUV Information 202-089; Stand 19.11.2026.

### Gelöschte Daten und Sicherungen

Gelöschte Akten stecken noch in älteren Sicherungen. Die automatischen Nachtsicherungen im Ordner
`/data/backups` werden 14 Tage aufbewahrt, danach sind die Daten dort ebenfalls weg. Von Hand
heruntergeladene oder auf andere Rechner kopierte Sicherungen löscht die App nicht. Räume diese selbst auf,
sonst bleiben Kinderdaten über die Löschfrist hinaus erhalten.

### Sicherungen sicher aufbewahren

Die Datei, die du unter *Einstellungen → Einrichtung → Datensicherung → Datenbank herunterladen* bekommst, enthält
**alle Kinderdaten inklusive aller Dokumente**. Das Gleiche gilt für die Nachtsicherungen.

- Speichere sie nur an geschützten Orten (verschlüsseltes Laufwerk, zugriffsgeschützter Ordner).
- Gib sie nicht per E-Mail oder über unverschlüsselte USB-Sticks weiter.
- Lösche sie, wenn du sie nicht mehr brauchst.

### Verschlüsselung der Server-Festplatte

Die App verschlüsselt die Datenbank nicht selbst. Verschlüssele deshalb die Festplatte des Servers
(Verantwortung des Betreibers, z. B. mit LUKS unter Linux oder der Verschlüsselung deines Hosters).
Sonst sind die Kinderdaten lesbar, wenn jemand Zugriff auf die Festplatte oder eine Server-Kopie hat.

## 9. Platzplanung (Vormerkungen, Belegung, Höchstzahl Kinder, Gruppenwechsel, Schulkinder)

### Vormerkungen

- Ein Kind, das sich nur gemeldet hat, legst du mit dem Stand „Vormerkung“ an. Es hat noch keinen Vertrag,
  steht in einer eigenen Liste und wird in der Belegung **nicht gezählt**.
- Vormerkungen werden **nicht automatisch gelöscht**. Sieh die Liste deshalb regelmäßig durch und lösche
  Vormerkungen, die nicht mehr gebraucht werden (Leitung und Träger: „Vormerkung löschen“).
- Ein Kind, das schon aufgenommen ist, kann nicht wieder zur Vormerkung werden.

### Belegung

Die Belegung (Leitung und Träger) zeigt pro Kita-Jahr (1. September bis 31. August) eine Zahl je Gruppe und
Monat. Ein Beispiel: **„17 (+2)“** heißt, 17 Kinder waren schon vor diesem Monat in der Gruppe, 2 kommen in
diesem Monat neu dazu (Eingewöhnung oder Wechsel aus einer anderen Gruppe). Ein Kind zählt in jedem Monat, in
dem es mindestens an einem Tag in der Gruppe ist, also auch im Monat seines letzten Tages. Eine Zelle wird
rot, sobald die **Plätze** der Gruppe erreicht sind. Unter der Tabelle stehen Hinweise auf Kinder, die nicht
gezählt werden: Verträge ohne Eintrittsdatum und Kinder, deren Schulstart oder Austritt am oder vor dem
Eintritt liegt.

Die Zeile **„Summe“** zählt jedes Kind der Einrichtung einmal. Hat der Träger eine **Höchstzahl Kinder in der
Einrichtung** eingetragen, wird die Summe damit verglichen (rot ab Erreichen, „+n über Plätze“ darüber), auch wenn
die Gruppen zusammen mehr Plätze haben. Ohne diese Zahl gilt wie bisher die Summe der Plätze aller Gruppen, aber
nur, wenn jede Gruppe Plätze hat. Der Ausdruck der Belegung zeigt dasselbe.

- **Kinder in einer Gruppe „für Schulkinder“ (z. B. Hort)** zählen ohne Enddatum weiter, auch nach ihrem
  Schulstart. Sie werden nie automatisch abgemeldet. Melde sie von Hand ab, wenn sie gehen, sonst bleiben sie
  in der Belegung stehen.
- **Nach dem Verschieben in eine andere Einrichtung** zählt ein Kind in der neuen Einrichtung erst **ab dem Tag
  des Verschiebens**, nicht ab seinem ursprünglichen Eintritt. In der alten Einrichtung erscheint es nicht mehr,
  auch nicht in den zurückliegenden Monaten: Die Akte gehört jetzt zur neuen Einrichtung.

### Höchstzahl Kinder (Gruppen und Einrichtung)

- **Pro Gruppe:** Leitung und Träger tragen unter *Einstellungen → Gruppen → ‹Gruppe› →* **„Höchstzahl Kinder“** für
  jede Gruppe der aktuellen Einrichtung eine Zahl von 1 bis 200 ein (leer = keine). Das ist dieselbe Zahl wie
  **„Plätze“** in der Belegung; du kannst sie an beiden Stellen ändern. In der Belegung führt der Name der Gruppe
  direkt zur Seite der Gruppe in den Einstellungen.
- **Für die ganze Einrichtung:** Nur der Träger trägt unter *Einstellungen → Einrichtung → Einrichtungen* bei jeder Einrichtung
  die **„Höchstzahl Kinder in der Einrichtung“** ein, z. B. aus der Betriebserlaubnis: 1 bis 999 (leer = keine;
  200 wie bei einer Gruppe reicht für eine große Einrichtung nicht). Sie darf kleiner sein als die Plätze aller
  Gruppen zusammen. Die Leitung sieht sie auf der Seite jeder Gruppe (*Einstellungen → Gruppen*) und in der
  Belegung, ändern kann sie sie nicht.
- **Hinweis, keine Sperre:** Wird ein Kind angelegt, bekommt eine Vormerkung einen Vertrag, wechselt ein Kind die
  Gruppe (sofort oder geplant, auch beim Ändern oder Löschen eines geplanten Wechsels) oder wird eine Abmeldung
  zurückgenommen, und ist die Gruppe oder die Einrichtung dadurch in einem Monat über ihrer Höchstzahl, zeigt die
  App nach dem Speichern einen gelben Hinweis, z. B. **„Bären hat dann 21 von 20 Plätzen (ab November 2026).“**
  oder **„Die Einrichtung hat dann 61 von 60 Plätzen (ab September 2027).“** Gespeichert wird trotzdem. Die App
  zählt dabei wie die Belegung (Monate ab dem laufenden Monat); genannt wird der erste Monat über der Höchstzahl und
  die höchste Zahl der Kinder in diesen Monaten. Den Hinweis sehen nur Leitung und Träger, weil nur sie die Plätze
  sehen; ein Mitarbeiter am Tablet bekommt ihn nicht.

### Gruppenwechsel

Einen Wechsel planst du mit Datum. Am Wechseltag stellt die App das Kind automatisch in die neue Gruppe.
Bereiche, die du nicht übernommen hast (z. B. Gesundheit), bleiben sichtbar und sind als „nicht bestätigt“
markiert, bis jemand sie durchsieht und bestätigt. Alle offenen Fälle stehen im Reiter „Offen“ (*Kinder → Kinder*).

### Schulkinder

- **Stichtag prüfen:** Der Träger stellt pro Einrichtung den Stichtag ein (beim Anlegen einer Einrichtung aus dem Bundesland vorausgefüllt, z. B. 30. Juni bei Baden-Württemberg, 6 Jahre).
  Die Regeln unterscheiden sich je Bundesland und ändern sich manchmal. Bitte prüfe den Wert für deine
  Einrichtung.
- **Wie gerechnet wird:** Der Stichtag ist der **letzte Geburtstag**, der noch dazugehört („Geburtstag bis
  einschließlich ‹Stichtag›“). Kinder, die sechs Jahre vor dem Schulstart bis einschließlich zu diesem Tag geboren
  sind, kommen zum 1. September in die Schule. In **Baden-Württemberg** ist das der **30. Juni**: ein am 30. Juni
  geborenes Kind kommt in diesem Jahr, ein am 1. Juli geborenes ein Jahr später. Die Einstellungen zeigen genau das
  Datum, das gespeichert ist.
- **Entscheidung vom 20.11.2026 (Nutzer):** „Letzter Stichtag ist 30. Juni.“ Damit gilt wieder die Rechnung von vor
  dem 19.11.2026. Am 19.11.2026 hatte die App den Stichtag kurz als „bis zum Ende des Stichtags vollendet“ gelesen
  (ein am 1. Juli geborenes Kind wäre in Baden-Württemberg schon dieses Jahr gekommen) und dazu die Vorschläge für
  Hamburg, Bayern, Nordrhein-Westfalen und Thüringen um einen Tag verschoben. Das ist zurückgenommen.
- **Vorschläge der Bundesländer** (Geburtstag bis einschließlich): Baden-Württemberg 30.06.; **Bayern** (Art. 37
  BayEUG: „bis zum 30. September sechs Jahre alt werden“) und **Nordrhein-Westfalen** (§ 35 SchulG: „bis zum Beginn
  des 30. September … vollendet“) 30.09.; **Thüringen** (§ 18 Abs. 1 ThürSchulG: „am 1. August eines Jahres sechs
  Jahre alt“) 01.08.; **Hamburg** (§ 38 Abs. 1 HmbSG: „vor dem 1. Juli das 6. Lebensjahr vollendet“) 01.07. Bei
  Bayern, Nordrhein-Westfalen, Thüringen und Hamburg steht der Wortlaut des Gesetzes als Hinweis dabei.
- **Update der Datenbank:** Ein Update hatte am 19./20.11.2026 die gespeicherten Vorschläge umgestellt (Hamburg
  01.07. → 30.06., Bayern und Nordrhein-Westfalen 30.09. → 29.09., Thüringen 01.08. → 31.07.). Das nächste Update stellt
  sie zurück – aber nur, wo in einer Einrichtung dieses Bundeslands noch genau der umgestellte Wert (bei 6 Jahren)
  steht. Ein von Hand anders eingestellter Stichtag bleibt unverändert; weicht er vom Vorschlag ab, zeigt
  *Einstellungen → Kinder → Schulkinder* den Vorschlag mit **„übernehmen“** (das schaltet wie jede Stichtagsänderung
  die automatische Abmeldung aus). **Wer den Stichtag in den letzten Tagen von Hand geändert hat, prüft ihn bitte.**
- Quelle: Schulgesetze der Länder (Rechtsprüfung vom 19.11.2026; Wortlaut HmbSG § 38 Abs. 1 und ThürSchulG § 18 Abs. 1
  am 20.11.2026 über die konsolidierte Fassung bei lexaris.de geprüft) und die Entscheidung vom 20.11.2026 für
  Baden-Württemberg. Keine Rechtsberatung.
- Schulstart ist immer der 1. September. Ein von Hand eingetragener „voraussichtlicher Schulstart“
  (z. B. bei Zurückstellung) hat Vorrang.
- In der Kinderakte steht der „voraussichtliche Schulstart“ schon beim Anlegen da, sobald das Geburtsdatum
  eingetragen ist („automatisch nach Stichtag“). Ändern („Ändern“, zurück mit „Wieder automatisch“) können ihn nur
  Leitung und Träger; für alle anderen ist er nur zu lesen. Ein automatischer Schulstart folgt späteren Änderungen
  von Stichtag oder Geburtsdatum.
- Ab 1. März zeigt die Belegung die Liste **„Schulkinder zum 1.9.“**, damit du Zurückstellungen rechtzeitig
  einträgst.

### Automatische Abmeldung der Schulkinder

- Der Schalter „Schulkinder automatisch abmelden“ ist **voreingestellt aus**. Nur der Träger schaltet ihn pro
  Einrichtung ein.
- Beim Einschalten zeigt die App, welche Kinder **sofort** abgemeldet werden (Schulstart schon erreicht), und
  bei jedem Kind, **ab welchem Tag seine Akte gelöscht werden darf**. Erst nach deiner Bestätigung wird eingeschaltet
  und abgemeldet.
- Danach bekommen alle Schulkinder am 1. September den Austritt 31. August und kommen ins Archiv.
  Ab dann läuft die Löschfrist (siehe Abschnitt 8).
- **Nicht abgemeldet** werden Kinder mit späterem, von Hand eingetragenem Schulstart, Kinder, die erst am oder
  nach ihrem Schulstart aufgenommen wurden, und Kinder, die in einer Gruppe „für Schulkinder“ sind oder dorthin
  wechseln. Diese meldest du bei Bedarf von Hand ab.
- **Schulkinder-Gruppen (z. B. Hort):** Der Träger kennzeichnet sie in der Gruppenverwaltung. Beim Wechsel in
  eine solche Gruppe musst du bestätigen, dass ein weiterer Betreuungsvertrag abgeschlossen wurde. Der
  Betreuungsvertrag ist danach „nicht bestätigt“, bis der neue Vertrag hochgeladen ist.
- **Der Schalter schaltet sich von selbst aus**, wenn der Stichtag geändert wird, wenn einer Gruppe das
  Kennzeichen „für Schulkinder“ genommen oder eine solche Gruppe gelöscht wird. Die App weist darauf hin. Prüfe
  dann die Liste und schalte wieder ein.

Solange der Schalter eingeschaltet ist, schützt die App davor, dass ein einzelnes Kind unbemerkt abgemeldet
wird:

- **Einzelne Änderungen werden abgelehnt**, wenn das Kind dadurch beim nächsten täglichen Lauf sofort
  abgemeldet würde. Beispiele: Du löschst einen späteren voraussichtlichen Schulstart, änderst das
  Geburtsdatum oder den Eintritt, legst ein Kind an, dessen Schulstart schon erreicht ist, machst aus einer
  Vormerkung einen Vertrag oder löschst den geplanten Wechsel in eine Gruppe „für Schulkinder“. Die App sagt
  dann, was zu tun ist: einen späteren voraussichtlichen Schulstart eintragen oder die automatische Abmeldung
  ausschalten. Soll das Kind wirklich gehen, melde es von Hand ab.
- **Verschieben in eine andere Einrichtung wird abgelehnt**, wenn die Ziel-Einrichtung automatisch abmeldet
  und das Kind dort sofort abgemeldet würde (Schulstart schon erreicht). Passe zuerst den voraussichtlichen
  Schulstart an oder schalte dort die automatische Abmeldung aus.
- **Abmeldung zurücknehmen:** Ist der Schulstart des Kindes schon erreicht, fragt die App nach einem neuen
  voraussichtlichen Schulstart in der Zukunft. Sonst würde das Kind gleich wieder abgemeldet. Ist der Schalter
  ausgeschaltet, nimmst du die Abmeldung ohne diese Angabe zurück.

Bundesland und Stichtag: siehe Abschnitt 10.

## 10. Bundesland und Feiertage

- **Wer stellt es ein:** Nur der Träger, unter *Einstellungen → Einrichtung → Einrichtungen*. Beim Anlegen einer Einrichtung wählt er
  das Bundesland (voreingestellt: Baden-Württemberg); alle bestehenden Einrichtungen sind Baden-Württemberg. Die
  Leitung sieht die Feiertage ihres Bundeslands, kann es aber nicht ändern. Für Bayern gibt es das Häkchen
  „Mariä Himmelfahrt ist hier Feiertag“ (nicht in allen bayerischen Gemeinden ein Feiertag).
- **Was sich danach richtet:** Die gesetzlichen Feiertage in Dienstplan, Kalendern, Sollstunden, Stundenkonten und
  Urlaubstagen. Für einen Mitarbeiter gelten die Feiertage der **Stammeinrichtung**, im Plan einer Einrichtung die
  Feiertage dieser Einrichtung.
- **Rückwirkend:** Ein anderes Bundesland (oder das Bayern-Häkchen) gilt sofort für **alle Tage, auch für
  vergangene Monate**. Sollstunden, Stundenkonten und Urlaubstage können sich dadurch ändern. Die App warnt und
  speichert erst nach deiner Bestätigung. Dasselbe gilt, wenn ein Mitarbeiter in eine Einrichtung in einem anderen
  Bundesland verschoben wird.
- **Schließzeiten werden für neue Arbeitstage automatisch ergänzt:** Wird durch die Änderung ein Tag in einer schon
  eingetragenen Schließzeit zum Arbeitstag (z. B. Mariä Himmelfahrt nach dem Abhaken des Bayern-Häkchens), trägt die
  App dort für die Mitarbeiter der Einrichtung die Schließzeit nach (bei „Urlaub“ zählt der Tag als Urlaubstag).
  Schon vorhandene Einträge an diesem Tag bleiben unverändert. Wird ein Tag zum Feiertag, kostet er keinen
  Urlaubstag mehr; dafür musst du nichts tun.
- **Örtliche und einmalige Feiertage** (z. B. Fronleichnam in einzelnen Gemeinden in Sachsen und Thüringen, das
  Augsburger Friedensfest, einmalige Sonderfeiertage) berechnet die App nicht. Trage sie als Schließzeit ein.
  Ostersonntag und Pfingstsonntag werden nicht geführt, weil sie immer auf einen Sonntag fallen.
- **Stichtag für Schulkinder:** Eine neu angelegte Einrichtung bekommt den Stichtag ihres Bundeslands. Ändert der
  Träger das Bundesland, bleibt der eingestellte Stichtag unverändert. Weicht er vom Stichtag des Bundeslands ab,
  zeigt *Einstellungen → Kinder → Schulkinder* diesen mit dem Knopf **„übernehmen“**. Das ist eine normale
  Stichtagsänderung und schaltet die automatische Abmeldung der Schulkinder aus (siehe Abschnitt 9). Die
  Stichtage stehen im Stand 20.11.2026 (Stichtag = letzter Geburtstag, der noch dazugehört, siehe Abschnitt 9); prüfe
  sie bei Änderungen des Schulgesetzes.

## 11. Anwesenheit der Kinder

Unter *Kinder → Heute* ist **„Anwesenheit“** der erste Reiter. Er öffnet die Tagesliste von heute. Oben steht nur
eine schmale Leiste: mit **„Tag“**/**„Monat“** wechselst du zur Monatsübersicht, mit den Pfeilen, dem Datum und
**„Heute“** den Tag. Darunter steht eine Zeile mit den Zahlen, z. B. „Da 12 · Noch nicht da 3 · Abwesend 2 ·
Snack 8 · Mittagessen 10“ (die Essen nach Uhrzeit; „Abgeholt“, sobald ein Kind abgeholt ist). Ein Tipp auf die Zeile
klappt die genauen Zahlen und den Kasten „Essen heute“ auf; das Gerät merkt sich, ob er auf- oder zugeklappt ist
(anfangs zu). Direkt darunter beginnt die Liste der Kinder.

### Ein- und Ausstempeln am Tablet

- Am Tablet stempelt jede aufgeschlossene Person die Kinder ein und aus – auch wer kein eigenes Konto hat und
  Aushilfen an ihren Einsatztagen. Leitung und Träger können das auf jedem Gerät. Mit dem eigenen
  Mitarbeiterkonto (Handy, privater PC) gibt es die Anwesenheit nicht.
- Die Liste zeigt immer **alle** Kinder der Einrichtung. Bei Kindern einer **fremden Gruppe** geht für
  Mitarbeiter mit Gruppe nur Kommen, Gehen und Abholer ankündigen (siehe Abschnitt 12).
- Aufgeklappt (Tipp auf die Zahlenzeile) steht, wie viele Kinder da, abgeholt, abwesend und noch nicht da sind,
  darunter der Kasten **„Essen heute“** (siehe „Essen“ unten). Die Liste ist nach Gruppen geordnet (Kinder ohne Gruppe am Ende); wie sie
  aussieht, steht unter „Die Liste am Bildschirm“.
- **„Kommt“**: Uhrzeit (vorgeschlagen ist jetzt) und **geplante Abholzeit** (Pflicht). Vorgeschlagen wird das
  Ende der Betreuungszeit aus der Betreuungsform des Kindes. Ist unter *Einstellungen → Kinder → Anwesenheit & Essen* „Bringperson
  erfassen“ an, fragt der Dialog zusätzlich, wer das Kind gebracht hat. Ein Kind, das schon abgeholt wurde, kann
  am selben Tag noch einmal kommen (z. B. nach einem Arzttermin).
- **„Geht“**: Uhrzeit (nicht vor der Ankunft) und **wer abholt**. Zur Auswahl stehen die Bezugspersonen mit
  „darf abholen“ und die Personen, die für diesen Tag angekündigt sind. Personen mit Umgangsverbot stehen nie in
  der Auswahl; hat das Kind ein Umgangsverbot, zeigt der Dialog den Hinweis aus der Akte in Rot.
- Holt jemand ab, der weder in der Akte steht noch angekündigt ist, tippst du auf **„Andere Person“**, gibst
  den Namen ein und – wenn es eine gab – mit wem das abgesprochen ist (**„Rücksprache mit“**, z. B. „Mama,
  telefonisch“). Der Name einer Person mit Umgangsverbot wird abgewiesen. Steht die Person in der Akte, aber ohne
  „darf abholen“, zeigt der Dialog vor dem Speichern einen gelben Hinweis: dann bitte nur nach Rücksprache mit den
  Sorgeberechtigten. In der Tagesliste, im Druck und im Verlauf steht danach „Name (nicht hinterlegt)“, so sieht man
  auch später, dass die Person nicht eingetragen war. Die „Rücksprache mit“ steht in der Tagesliste klein unter dem
  Aufenthalt, beim „Zeiten korrigieren“, im Verlauf und im Druck unter Info. Auch beim „Zeiten korrigieren“ kannst
  du „Andere Person“ wählen.
- **Abholzeit überschritten**: Ist ein Kind 15 Minuten nach seiner geplanten Abholzeit noch da, wird seine Zeile
  rot – auch wenn die Liste die ganze Zeit offen ist (die Markierung folgt der Uhr des Geräts, jede Minute).
  Einträge anderer Geräte erscheinen erst nach dem nächsten eigenen Eintrag oder beim Öffnen der Liste; die Liste
  fragt nicht selbst beim Server nach, damit sich das Tablet nach der Sperrzeit sperrt.
- **Nicht ausgestempelt**: Wurde ein Kind an einem der letzten 14 Tage nicht ausgestempelt, steht oben über der Liste
  (immer sichtbar, auch bei zugeklappten Zahlen) eine schmale gelbe Zeile je Tag mit dem Knopf **„Zum Tag“**. Dort trägst du die Abholung über **„Zeiten korrigieren“** (Stift am Aufenthalt) nach.

### Angekündigte Abholer

Holt heute jemand anderes ab (z. B. die Oma), trägst du ihn mit **„Abholer ankündigen“** ein: Name und
freiwillig „angekündigt von“ (z. B. „Mama, telefonisch“). Die Person gilt nur für diesen Tag, steht beim Kind
(„Abholer heute: …“) und kann beim Gehen gewählt werden. Im selben Dialog kannst du sie wieder entfernen.

### Abwesenheiten

**„Abwesend“** gibt es für ein Kind, das an dem Tag noch nicht da war: krank, Urlaub oder entschuldigt, für
diesen Tag oder bis zu einem Enddatum (z. B. angekündigter Urlaub). Eingetragen wird an Betreuungstagen; Wochenenden,
Feiertage und Schließtage werden übersprungen. Kommt ein abwesend eingetragenes Kind doch, ersetzt „Kommt“ die
Abwesenheit für diesen Tag. Ist an einem vergangenen Betreuungstag nichts eingetragen, gilt das Kind als
unentschuldigt (–) – aber erst ab dem Tag, der unter *Einstellungen → Kinder → Anwesenheit & Essen* bei **„Anwesenheit erfasst ab“**
steht (der erste Eintrag setzt ihn von selbst; Tage davor bleiben leer und zählen nicht).

### Essen

- **Welche Essen es gibt**, legen Leitung und Träger unter *Einstellungen → Kinder → Anwesenheit & Essen* im Block **„Essen“** fest,
  je Einrichtung: Name (z. B. „Frühstück“, „Vesper“; höchstens 40 Zeichen, nicht doppelt) und Uhrzeit, höchstens
  8 Essen. Voreingestellt sind Snack 9:30 und Mittagessen 12:00. Es darf auch kein Essen geben; dann zeigen Liste
  und Druck keine Essensspalten und keinen Essenskasten.
- **„Ändern“** (Name, Uhrzeit), **„Entfernen“** und **„Essen hinzufügen“** fragen nach **„gilt ab“** (voreingestellt
  heute, frühestens heute). **Vergangene Tage ändern sich nie**: Tage davor behalten die Essen mit Name und Uhrzeit
  von damals, dort wird weiter nach der alten Uhrzeit gezählt, und alle Häkchen bleiben. Ein entferntes Essen
  ist an früheren Tagen weiter mit seinen Häkchen zu sehen.
- Änderungen ab heute oder einem späteren Tag stehen unter **„Geplante und heutige Änderungen“** („ab 01.11.:
  Mittagessen 12:15“, „ab 01.11.: Vesper entfällt“, eine Änderung von heute als „ab heute: …“). Mit
  **„Zurücknehmen“** nimmst du eine davon wieder zurück, auch eine von heute: Nimmst du z. B. „ab heute: Vesper
  entfällt“ zurück, ist Vesper heute wieder da, mit den Häkchen von heute. Ein Essen, das erst heute oder später
  beginnen sollte, ist dann ganz weg; bei einem Essen ab heute gehen dabei die Häkchen von heute verloren (das
  Fenster sagt das vorher). Auch beim Zurücknehmen gilt: kein Name doppelt, höchstens 8 Essen.
- **Zählen**: Ein Kind zählt für ein Essen, wenn es zu dessen Uhrzeit da ist oder laut geplanter Abholzeit da sein
  wird. Je Essen gibt es beim Kind ein Häkchen (nach Uhrzeit geordnet); ein Tipp ändert das für den Tag von Hand
  (z. B. „isst heute nicht mit“, dann steht „(von Hand)“ daneben), der Pfeil daneben stellt **„Wieder automatisch
  zählen“** ein.
- **Kasten „Essen heute“** über der Liste, aufgeklappt über die Zahlenzeile (an einem anderen Tag „Essen am 14.10.2026“): je Essen die Zahl der
  Kinder („Snack 9:30: 12 · Mittagessen 12:00: 15“), darunter eine kleine Tabelle je Gruppe: **Kinder da** (da
  oder heute schon abgeholt) und je Essen, wie viele mitessen und wie viele Kinder der Gruppe nicht (z. B. „10 · 2
  nicht“; mitgezählt sind alle Kinder der Liste, auch abwesende und noch nicht gekommene). Kinder ohne Gruppe
  stehen als „ohne Gruppe“, die letzte Zeile ist **„Gesamt“**. Es stehen nur Zahlen da, keine Namen.
- Jeder Tag zeigt die Essen, die **an diesem Tag** galten. So ist auch später nachvollziehbar, welches Kind zu
  welchem Essen da war und ob automatisch oder von Hand gezählt. Im Verlauf steht bei einem Häkchen der Name des
  Essens von damals.

### Die Liste am Bildschirm

- **Eine Zeile je Kind**, farbig nach dem Stand: **grün** da, **grau** abgeholt, **blau** abwesend, **gelb**
  unentschuldigt, **weiß** noch nicht da, **rot** Abholzeit überschritten. In der Zeile stehen Name, Stand, geplante
  Abholzeit, die gezählten Essen und kleine Hinweise (Allergie, „kein Insektenschutz“, Notiz vorhanden, geändert).
  Hat ein Kind ein **Kontaktverbot**, steht das in seiner Zeile immer in Rot, in jeder Farbe der Zeile.
- **„Kommt“** und **„Geht“** stehen rechts in der Zeile; du brauchst die Zeile dafür nicht zu öffnen.
- **Antippen** der Zeile öffnet alles zum Kind: Aufenthalte mit den Zeiten, **Abholzeit**, die **Essen**, die
  **Infospalte** (die **Allergien und Unverträglichkeiten** aus der Akte, bei „nein“ zum Insektenschutz **„kein
  Insektenschutz“**, und das Feld **„Was ist heute passiert“** für kurze Notizen über den Tag, z. B. „hingefallen,
  Knie gekühlt“, damit sie beim Abholen weitergegeben werden), den **Verlauf** sowie **„Abwesend“** und **„Abholer
  ankündigen“**. Du kannst mehrere Zeilen gleichzeitig öffnen; beim Neuladen der Seite sind sie wieder zu. Andere
  Inhalte der Akte und vertrauliche Dokumente erscheinen hier nie.
- **Gruppen einklappen**: Ein Tipp auf die Gruppenüberschrift klappt die Gruppe ein oder aus. Das merkt sich das
  Gerät. Eine eingeklappte Gruppe zeigt ihre **überfälligen Kinder** (Abholzeit überschritten) weiter an, und die
  Überschrift warnt in Rot, z. B. **„2 überfällig“** und **„Kontaktverbot“**, wenn ein Kind der Gruppe ein
  Kontaktverbot hat.

### Monatsübersicht

Pro Gruppe eine Tabelle mit einer Zeile je Kind: ✓ da, K krank, U Urlaub, E entschuldigt, – unentschuldigt.
Grau sind Wochenenden, Feiertage und Schließtage; schraffiert sind Tage, an denen das Kind nicht in dieser Gruppe
(oder noch nicht bzw. nicht mehr in der Kita) war. Rechts stehen die Summen und eine **Bemerkung** pro Kind und
Monat. Ein Tipp auf eine Tageszahl öffnet diesen Tag.

### Drucken im Büro

Tagesliste und Monatsübersicht drucken Leitung und Träger im Büro mit **„Drucken“** (A4 quer, als Ausdruck oder
PDF). Der Ausdruck der Tagesliste hat je Essen eine Spalte mit ✓, darüber stehen unter „Essen am ‹Datum›“
dieselbe Gesamtzahl je Essen und dieselbe Tabelle je Gruppe wie im Kasten „Essen heute“, in der Infospalte auch
„kein Insektenschutz“. Am Tablet gibt es keine Druck-Knöpfe; dort ist die Liste jederzeit am Bildschirm zu sehen
(z. B. bei einer Räumung).

### Ändern und Verlauf

Alle Angaben lassen sich ändern, auch an älteren Tagen: Zeiten und Abholperson über den Stift am Aufenthalt
(ein versehentlich gestempelter Aufenthalt lässt sich dort auch löschen), die geplante Abholzeit und die Notiz
in der geöffneten Zeile. Jede Änderung wird mit Person und Uhrzeit festgehalten. Ein kleines Verlaufs-Symbol in der
Zeile zeigt, dass ein Eintrag geändert wurde; in der geöffneten Zeile zeigt ein Tipp darauf den Verlauf.

## 12. Wochenübersicht und Gruppenbücher

Jede Gruppe hat ihr eigenes **Gruppenbuch**: die Wochenübersicht und die Kinderakten ihrer Kinder (Liste, Akte,
Geburtstage, Dokumente, „Offen“).

### Die Wochenübersicht

- Unter *Kinder → Heute* ist **„Wochenübersicht“** der Reiter nach „Anwesenheit“: am Tablet nach dem Aufschließen, für
  Leitung und Träger auf jedem Gerät.
- Oben stehen Kalenderwoche und Tage („KW 43 · 19.–23.10.2026“). Mit den Pfeilen und **„Diese Woche“** wechselst
  du die Woche, mit der Auswahl daneben die Gruppe (nur, wenn du mehr als eine Gruppe sehen darfst). Geöffnet wird
  die eigene Gruppe.
- Es gibt ein Feld **„Wochenthema / geplant“** für die Woche und für Montag bis Freitag je ein Feld **„Was haben
  wir gemacht“**. Feiertage und Schließtage sind grau und beschriftet; eintragen kannst du dort trotzdem.
- Gespeichert wird, sobald du ein Feld verlässt (oder mit **„Speichern“** darunter). Eintragen geht auch für
  vergangene Wochen.
- Unter jedem Feld steht, wer es zuletzt geändert hat und wann. Ein Tipp darauf zeigt den ganzen **Verlauf**
  (vorher → nachher, wer, wann) – auch mit dem Namen der Person, die das Tablet aufgeschlossen hat, wenn sie kein
  eigenes Konto hat.
- Wird eine Gruppe gelöscht, werden ihre Wochenübersichten mit gelöscht.

### Wer was sieht

| Person | Gruppenbücher |
|---|---|
| Leitung und Träger (jedes Gerät), Mitarbeiter ohne Gruppe, Aushilfen | alle Gruppen, sehen und eintragen (im Rahmen ihrer bisherigen Rechte) |
| Mitarbeiter mit Gruppe (am Tablet) | die **eigene Gruppe** sehen und eintragen; **freigeschaltete Gruppen** nur lesen; alle anderen Gruppen sehen sie nicht |

- Die eigene Gruppe ist die Gruppe aus dem Mitarbeiter-Eintrag in der Stammeinrichtung.
- **Nur lesen** heißt: Wochenübersicht und Kinderakten ansehen, aber nichts eintragen oder ändern – auch nicht mit
  dem Recht „eintragen und Akten ändern“. Vertrauliche Dokumente öffnet die Person dort nur, wenn sie das in der eigenen Gruppe
  auch dürfte. Die Wochenübersicht zeigt dann oben „Nur lesen“.
- Kinder ohne Gruppe sieht jeder.

### Freischalten (Einstellungen)

- Welche anderen Gruppen eine Gruppe zusätzlich **lesen** darf, legt die Leitung unter *Einstellungen → Gruppen →
  ‹Gruppe› → Darf zusätzlich lesen* fest. Der Träger hat denselben Block auf der Seite jeder Gruppe (für die gerade
  gewählte Einrichtung) und außerdem *Einstellungen → Einrichtung → Einrichtungen* bei den Gruppen jeder Einrichtung.
  Überall gilt: „Darf zusätzlich lesen:“ mit einem Häkchen je andere Gruppe. Voreingestellt ist keine.
- Das gilt nur in eine Richtung: Darf die Gruppe A die Gruppe B lesen, darf B deshalb noch nicht A lesen.
- Änderungen wirken sofort, auch an einem gerade aufgeschlossenen Tablet.

### Gruppenfarben (Jahreskalender und Urlaubsplanung)

Leitung und Träger geben jeder Gruppe unter *Einstellungen → Gruppen → ‹Gruppe› → Gruppenfarben* eine helle Farbe (für die gerade
gewählte Einrichtung; voreingestellt ist „keine Farbe“). Im Jahreskalender, in der Urlaubsplanung, in „Mein
Kalender“ und im Ausdruck des Jahreskalenders stehen die Mitarbeiter dann nach Gruppen sortiert (in der Reihenfolge
der Gruppen, Mitarbeiter ohne Gruppe am Ende), ihr Name hat die Farbe ihrer Stammgruppe, und über dem Kalender
steht eine kleine Legende der Gruppenfarben. Mitarbeiter ohne Gruppe und Gruppen ohne Farbe bleiben weiß. Die
Gruppenfarben sind heller als die Farben, mit denen der Kalender Abwesenheiten zeigt (z. B. das kräftige Blau der
Fortbildung), damit man Name und Abwesenheit nicht verwechselt. Zur Wahl stehen Gelb, Orange, Rosa, Pink, Lila,
Hellbraun, Türkis und Grau – Blau, Grün und Rot gibt es bewusst nicht. Gruppen, die früher „Blau“ hatten, sind nach
dem Update hellbraun.

### Reihenfolge der Gruppen

Die Gruppen stehen zuerst in der Reihenfolge, in der sie angelegt wurden. **Nur der Träger** ändert sie unter
*Einstellungen → Gruppen* mit den Pfeilen **nach oben / nach unten** neben jeder Gruppe (für die gerade gewählte
Einrichtung). Dienstplan, Belegung, Anwesenheit, Jahreskalender und Urlaubsplanung zeigen die Gruppen danach in
dieser Reihenfolge. Die Leitung sieht die Reihenfolge, aber keine Pfeile.

### Kinder fremder Gruppen in der Anwesenheit

- Die Anwesenheitsliste zeigt weiter **alle** Kinder. Maßgeblich ist die Gruppe des Kindes **an dem Tag**.
- Bei einem Kind einer fremden Gruppe (auch einer nur freigeschalteten) gibt es nur **„Kommt“**, **„Geht“** und
  **„Abholer ankündigen“**. Allergien, die Notiz des Tages, die Zeiten, die geplante Abholzeit und die Häkchen
  der Essen sind zu sehen, aber nicht zu ändern; „Abwesend“ und „Zeiten korrigieren“ gibt es dort nicht.
- War das Kind in einem Abwesenheits-Zeitraum an einzelnen Tagen in einer anderen Gruppe, wird nichts eingetragen
  und ein Hinweis erscheint: Trag die Abwesenheit dann nur für die Tage in deiner Gruppe ein.
- Der Name eines fremden Kindes führt nur dann zur Akte, wenn dessen Gruppe freigeschaltet ist (dann nur lesen).
- In der Monatsübersicht stehen alle Kinder; die **Bemerkung** kann nur die eigene Gruppe ändern.

### Drucken

Leitung und Träger drucken die Woche einer Gruppe im Büro mit **„Drucken“** (A4 quer: Einrichtung, Gruppe,
Kalenderwoche, Wochenthema und Montag bis Freitag nebeneinander, als Ausdruck oder PDF). Am Tablet gibt es keine
Druck-Knöpfe.

## 13. Öffnungszeiten und Pflichtdienste

Leitung und Träger stellen beides unter Einstellungen ein, jeweils für die Einrichtung, in der sie gerade arbeiten.

- **Öffnungszeiten:** Unter *Einstellungen → Einrichtung → Öffnungszeiten der Einrichtung* trägst du für Montag bis Freitag
  Öffnung und Schließung ein oder hakst „geschlossen“ an. Die Schließung muss nach der Öffnung liegen. Ein Tag ohne
  Eintrag gilt als „nicht eingetragen“: Dafür gibt es keine neue Warnung. Samstag und Sonntag lassen sich nicht eintragen; am Wochenende wird nie gewarnt.
- **Mindestzahlen:** „Mindestens zur Öffnung“ und „Mindestens bis zur Schließung“ (1 bis 20, voreingestellt 1).
- **Eigene Zeiten einer Gruppe:** Unter *Einstellungen → Gruppen → ‹Gruppe›* steht „Eigene Öffnungszeiten“ mit
  derselben Tabelle. Leer heißt: Es gelten die Zeiten der Einrichtung, die Gruppe hat dann keine
  eigene Warnung. Mit **„Eigene Zeiten entfernen“** fällt die Gruppe wieder auf die Einrichtung zurück. Hat eine
  Gruppe eigene Zeiten, prüft die Warnung der Gruppe nur die Dienste dieser Gruppe (eigene Gruppe des Dienstes,
  sonst die Stammgruppe des Mitarbeiters).
- **Anzeige im Dienstplan:** Im Kopf jedes Tages steht klein die Öffnungszeit („7:00–16:30“ oder „geschlossen“).
  Eigene Zeiten einer Gruppe stehen klein in deren Spalte „anwesend“. An Feiertagen und Schließtagen steht keine Öffnungszeit.
- **Rand-Warnung:** Zur Öffnung zählen Dienste, die als Betreuungskraft zählen (Dienste wie „HK Haushaltskraft“ zählen nicht), und die spätestens zur Öffnung beginnen und nach der Öffnung enden. Bis
  zur Schließung zählen Dienste, die vor der Schließung beginnen und frühestens zur Schließung enden. Sind es
  weniger als die Mindestzahl, steht im Dienstplan zum Beispiel „7:00 Öffnung: niemand eingeplant“ oder
  „16:30 Schließung: 1 von 2 eingeplant“ (bei einer Gruppe mit dem Gruppennamen davor). Für die Einrichtung zählen alle
  Dienste des Plans, auch von Aushilfen. Nicht geprüft werden Wochenenden, Feiertage, Schließtage, nicht eingetragene
  Tage und „geschlossen“.
- **Pflichtdienste je Wochentag:** Unter *Einstellungen → Dienstplan → Pflichtdienste* hat jeder Pflichtdienst die Knöpfe **Mo Di Mi Do Fr** (mindestens einer muss
  gewählt sein). Er wird nur an diesen Tagen geprüft; ist nicht jeder Tag gewählt, steht darunter z. B. „Mo–Do“.
  Bisherige Pflichtdienste gelten weiter an allen Werktagen. An einem als „geschlossen“ eingetragenen Tag wird kein
  Pflichtdienst geprüft (bei einer Gruppe: gilt „geschlossen“ der Gruppe, falls sie eigene Zeiten hat, sonst der
  Einrichtung).
- **Rückwirkend:** Änderungen an Öffnungszeiten und Pflichtdiensten gelten für alle Tage, auch für vergangene Monate.
  Wer nichts einträgt, bekommt keine neuen Warnungen.

### Dienstplanvorlagen

- **Warnungen im Vorlagen-Editor:** Der Editor prüft jeden Wochentag der Vorlage mit denselben Regeln wie der
  Dienstplan (Öffnung, Schließung, Pflichtdienste; ohne Feiertage und Schließzeiten). Eine Vorlage für eine Gruppe
  bekommt nur die Warnungen ihrer Gruppe. Speichern geht immer.
- **Info 1 / Info 2:** Nur eine Vorlage für die ganze Einrichtung hat Info-Texte (es sind die Tagesnotizen der
  Einrichtung). Beim Einsetzen kommen sie nur in leere Info-Felder, auch an Feiertagen und Schließtagen.
- **„Vorlage: … (eingesetzt am …)“ in der Wochenzeile** (nur Leitung/Bearbeiter, nicht gedruckt): Jedes Einsetzen
  einer Vorlage, das etwas einträgt, wird mit dem Namen der Vorlage, Zeitpunkt und dem **Benutzernamen** dessen, der
  sie eingesetzt hat, gespeichert (wie „Freigegeben von“). Diese Zeilen bleiben, auch wenn die Vorlage oder das Konto
  gelöscht wird, und gehen erst mit der Einrichtung. Sie enthalten sonst keine personenbezogenen Daten.
- **„– danach angepasst“** vergleicht die Einträge der Woche mit dem Stand direkt nach dem Einsetzen. Es erscheint
  also auch ohne Eingriff in die Woche, wenn ein Mitarbeiter die Einrichtung wechselt oder neu dazukommt, ein Dienst
  gelöscht wird, Dienste neue Zeiten bekommen („auch bestehende Dienste ändern“) oder der Plan auf die Freigabe
  zurückgesetzt wird. Wird etwas geändert und wieder genau zurückgeändert, verschwindet der Hinweis. Er ist ein
  Hinweis, kein Änderungsprotokoll.

## 14. Übersicht der Kinder (wie die Excel-Liste)

Unter *Kinder → Kinder* ist **„Übersicht“** der Reiter nach „Liste“. Er zeigt die Angaben der Kinder als Tabellen, aufgebaut
wie die Blätter der bisherigen Excel-Liste. Erfasst wird hier nichts: alle Werte kommen aus den Kinderakten und werden
dort geändert. Ein Kind steht je Zeile (Nachname, Vorname), nach Gruppen geordnet wie in der Liste und darin nach Alter
(das älteste Kind zuerst, bei gleichem Geburtstag nach Nachname), Kinder ohne Gruppe
am Ende („ohne Gruppe“). Mit der Gruppenauswahl zeigst du nur eine Gruppe. Der Name führt zur Akte.

### Die Unterreiter

| Unterreiter | Spalten |
|---|---|
| Datenschutz | Bastel-/Malarbeiten aufhängen · Einzel-/Gruppenfotos aufhängen · Fotoerlaubnis für fremde Portfolios · Fotos hausinterner Feste · Fotos, Namen, Geburtsdaten aufhängen · Gruppenarbeiten mit Namen ausstellen |
| Messenger | Kontaktaufnahme über WhatsApp · Fotos über WhatsApp · Fotos über Signal · WhatsApp-Elterngruppe |
| Gesundheit | Masernnachweis (mit Datum) · Belehrung Infektionsschutz (Datum) · Allergien · Fieber messen · Sonnenschutz · Pflaster kleben · Insektenschutz |
| Abholberechtigte | alle Bezugspersonen mit „darf abholen“, z. B. „Erika Muster (Oma)“ – Bezugspersonen mit Kontaktverbot stehen hier nie |
| Sorgeberechtigte | die sorgeberechtigten Bezugspersonen · **Kontaktverbot**: Name und Hinweis, rot |
| Anruf-Reihenfolge | je Spalte eine Bezugsperson in der Anruf-Reihenfolge (1., 2., …: zuerst die Eltern, dann die anderen mit „Anrufen als Nr.“, siehe Abschnitt 8) mit Beziehung und Telefonnummern – ohne Bezugspersonen mit Kontaktverbot |
| Telefonnummern | Adresse · je Spalte eine Bezugsperson in der Anruf-Reihenfolge (zuerst die Eltern, dann nach „Anrufen als Nr.“, siehe Abschnitt 8) mit Beziehung und Telefon privat / mobil / Arbeit – Bezugspersonen mit Kontaktverbot ganz am Ende, rot mit „– Kontaktverbot“ |
| Elterngespräche | Letztes Gespräch („20.10.2026 Entwicklungsgespräch“) · Nächstes geplant („12.11.2026 14:00 Eingewöhnung“) · Alle Gespräche („20.10.26 Entwicklungsgespräch“, neueste zuerst) · Anzahl – ohne die vertraulichen Notizen (Abschnitt 8) |

- Einwilligungen und Ja/Nein-Angaben: **✓** ja (grün), **✗** nein (rot), **–** offen (grau). Leere Textfelder
  (z. B. keine Allergien) bleiben leer.
- Die Spaltenköpfe sind kurz. Tippe auf einen Kopf (oder fahre mit der Maus darüber), um den vollen Text zu sehen.
- Am Tablet im Hochformat lässt sich die Tabelle seitlich wischen; die Namensspalte bleibt dabei stehen.

### Wer was sieht

Es gelten dieselben Regeln wie für die Kinderakten (Abschnitt 8 und 12): Mitarbeiter sehen die Übersicht nur am
aufgeschlossenen Tablet, mit Gruppe nur die eigene und die für sie freigeschalteten Gruppen; Mitarbeiter ohne Gruppe,
Aushilfen, Leitung und Träger sehen alle aktiven Kinder (keine Vormerkungen, kein Archiv). Der Server schickt nur die
Kinder, die die Person sehen darf – Telefonnummern und Kontaktverbote anderer Gruppen kommen gar nicht erst auf das
Gerät. Mit dem eigenen Konto (Handy, privater PC) sehen Mitarbeiter keine Übersicht.

### Drucken

Leitung und Träger drucken im Büro jeden Unterreiter mit **„Drucken“** (A4 quer, als Ausdruck oder PDF). Im Kopf
stehen Einrichtung, Unterreiter, die gewählte Gruppe bzw. „Alle Gruppen“ und das Datum. Am Tablet gibt es keine
Druck-Knöpfe.

## 15. Mitarbeiter

### Die Liste

- Unter *Mitarbeiter* steht **eine Zeile pro Person** (auf dem Handy eine kleine Karte): Name, Gruppe, Wochenstunden,
  **Stundenkonto heute** (grün im Plus, rot im Minus; immer der Stand von heute) und **Resturlaub** (frei verfügbare
  Tage im Jahr des Monats, der oben gewählt ist). Mit den Pfeilen neben dem Monat blätterst du zu einem anderen Jahr
  für den Resturlaub.
- Kleine Hinweise zeigen, was fehlt: **„PIN fehlt“**, **„PIN gesperrt“** (die PIN geht gerade nicht), **„Qualifikation
  fehlt“** (für den Personalschlüssel), **„Pflichttermine offen“** (überfällig, noch kein Eintrag oder bald fällig) und
  **„kein Zugang“** (die Person hat kein Benutzerkonto).
- Die Hinweise oben (Pflichttermine, Stufenaufstieg) sind in einer Zeile **„‹n› Hinweise“** zusammengefasst; ein Tipp
  darauf klappt sie auf. Ob die Leitung die Vertragsangaben sieht, stellt der Träger unter *Mehr → Rechte und Rollen*
  ein (Mitarbeiter → „Vertragsangaben ansehen“ bei der Leitung).
- In der Spalte „Nächste Stufe“ steht bei Personen in der Probezeit zusätzlich **„in Probezeit bis ‹TT.MM.›“** (nur für
  wer die Vertragsangaben sieht, bis einschließlich zum letzten Tag der Probezeit).
- **„Mitarbeiter anlegen“** oben öffnet das Formular für eine neue Person.
- **„Reihenfolge ändern“** blendet die Pfeile zum Verschieben ein; „Fertig“ blendet sie wieder aus.
- Wer ausgeschieden ist (das Datum „ausgeschieden am“ liegt vor heute), steht nicht mehr bei den aktiven Mitarbeitern,
  sondern am Ende der Seite im zugeklappten Abschnitt „Ausgeschiedene Mitarbeiter“ – gelöscht wird dabei nichts, der
  Name führt weiter zu allen Daten der Person.

### Ausgeschiedene Mitarbeiter endgültig löschen

- Im Abschnitt „Ausgeschiedene Mitarbeiter“ steht bei jeder Person **„Endgültig löschen“**, wenn die Einstellung es erlaubt (siehe unten). Das geht nur, wenn das
  Datum „ausgeschieden am“ **vor heute** liegt (wer heute ausscheidet, ist noch aktiv). Leitung und Träger dürfen das
  für die Mitarbeiter der Einrichtung, in der sie gerade arbeiten – nur nicht den **eigenen** Eintrag, und eine Person
  mit **Träger-Konto** löscht nur der Träger.
- Ob der Knopf da ist, legt der Träger unter *Einstellungen → Personal → Löschfristen* fest („Mitarbeiter endgültig
  löschen“): **aus** (niemand; gelöscht wird nur nach Ablauf der Fristen, vom Träger unter Mehr → Löschfristen),
  **nur Träger** oder **Leitung und
  Träger** (voreingestellt). Endgültig löschen beachtet die Aufbewahrungsfristen **nicht** – nur für Probe- und
  Fehleinträge; der Dialog weist darauf hin.
- Ein Dialog zählt auf, was gelöscht wird. Zum Bestätigen **tippst du den Namen genau so ein**, wie er dasteht; erst
  dann geht der Knopf. **Das lässt sich nicht rückgängig machen** – braucht ihr die Daten vielleicht noch, lädt der
  Träger vorher eine Sicherung herunter.
- **Gelöscht werden:** Stammdaten mit Notfallkontakten, Wochenstunden, Vertragsdaten und Stempel-PIN; die Personalakte
  (persönliche Daten, Lohn und Steuer, alle Dokumente); alle Dienstplan-Einträge aller Monate
  (auch in freigegebenen Plänen – die Person verschwindet dort aus der Spalte, der Rest des Plans bleibt freigegeben –
  und als Aushilfe in anderen Einrichtungen); das Änderungsprotokoll, die Benachrichtigungen und „Zur Kenntnis
  genommen“ zu dieser Person; Zeiterfassung mit Korrekturen und Notizen, „Im Dienst erkrankt“ und Krankheitstage;
  Stundenkonto-Buchungen, Urlaubsanspruch und Urlaubsanträge; Pflichttermine und Fortbildungen; Mitarbeitergespräche
  mit allen Bögen; Einträge in Dienstplan-Vorlagen und freigegebene Bögen zum Bearbeiten am Tablet.
- **Das Benutzerkonto** der Person wird mit gelöscht, wenn sie Mitarbeiter oder Leitung ist (die Anmeldung geht danach
  nicht mehr). Ein **Träger-Konto** bleibt bestehen und ist danach nur mit keinem Mitarbeiter mehr verknüpft.
- **Bleibt erhalten:** Teamsitzungen und alles, wo der Name nur als Bearbeiter steht (z. B. „eingetragen von …“ in der
  Kinderakte). Bei Kindern, deren Bezugserzieher die Person war, ist danach niemand eingetragen.

### Löschfristen

Die App löscht **nichts von selbst**. Die Fristen sagen, **ab wann** etwas gelöscht werden darf; gelöscht wird von
Hand durch den **Träger** auf der Seite **Mehr → Löschfristen** (siehe unten). Bei ausgeschiedenen Mitarbeitern gilt
je nach Art ein anderer Tag. Jede Frist beginnt am **Ende des Jahres**, in dem die Person ausgeschieden ist; löschbar
ist ab dem 1. Januar danach. Beispiel: ausgeschieden am 15.03.2026, Frist 2 Jahre → löschbar ab 01.01.2029.

| Löschbar ab | Was |
|---|---|
| am Tag nach „ausgeschieden am“ („Persönliche Daten“) | Geburtstag, PIN, Benutzerkonto (Leitung/Mitarbeiter gelöscht, ein Träger-Konto nur gelöst; gesperrt ist das Konto einer Leitung oder eines Mitarbeiters schon ab diesem Tag, siehe unten), Qualifikation, Vertragsdaten (mit „befristet bis“ und „Probezeit bis“), Notfallkontakte, Urlaubsanträge, Benachrichtigungen, Freischaltungen für Bögen; aus der Personalakte Geburtsjahr, Anschrift, Telefon, E-Mail, Staatsangehörigkeit, Schwerbehinderung und – solange ein Lohnbüro die Lohnunterlagen aufbewahrt (voreingestellt) – alles aus „Lohn und Steuer“; die Kinder der Person mit „alleinerziehend“; die Begründungen für Sonderurlaub (die Sonderurlaubstage selbst bleiben bei den Zeitdaten); als Bezugserzieher wird die Person bei Kindern entfernt |
| „Sonstige Überstunden- und Zeitdaten“ (voreingestellt 2 Jahre) | Dienstplan-Einträge mit Änderungsprotokoll, Wochenstunden-Verläufe, Aushilfen, Stempelzeiten, Notizen der Zeiterfassung, „Im Dienst erkrankt“, Stundenkonto-Buchungen ohne „ausgezahlt“, Krankheitstage, Urlaubsansprüche mit den Zusatztagen nur für ein Jahr |
| „Beurteilungen und Zeugnisse“ (3 Jahre) | Mitarbeitergespräche mit allen Bögen, Fortbildungsnachweise, Pflichttermine (Belehrung Infektionsschutz, Betriebsarzt, Erste Hilfe, Führungszeugnis, Masernnachweis, Untersuchungen nach dem Jugendarbeitsschutzgesetz) als Nachweis, dass die Pflichten erfüllt wurden, Lesebestätigungen aus „Wissen“; Dokumente der Personalakte in den Fächern Bewerbung, Qualifikationen und Fortbildungen, Korrespondenz, Arbeitsrechtliche Maßnahmen |
| „Ausgezahlte Überstunden“ (voreingestellt und mindestens 8 Jahre) | Stundenkonto-Buchungen mit dem Häkchen **„ausgezahlt“** (setzt du beim Anlegen der Buchung oder später in der Liste der Buchungen); Dokumente der Personalakte in den Fächern Vertrag und Nachträge und Gehalt; die Unfallanzeigen über die Person. Auf der Seite „Löschfristen“ heißt die Zeile „ausgezahlte Überstunden, Verträge, Gehalt“. 8 Jahre, weil Buchungsbelege seit 01.01.2025 so lange aufzubewahren sind (§ 147 Abs. 3 AO, § 257 Abs. 4 HGB, geändert durch das Bürokratieentlastungsgesetz IV; vorher 10 Jahre). Lohnkonto (§ 41 EStG), Geschäftsbriefe und sonstige Unterlagen: 6 Jahre; Bücher und Jahresabschlüsse: 10 Jahre (führt die App nicht). Bestehende Einrichtungen mit der alten Vorgabe 10 bekamen beim Update 8; eine selbst gewählte andere Zahl blieb. Weniger als 8 Jahre lassen sich nicht mehr speichern; war vorher weniger gespeichert, rechnet die App trotzdem mit 8 Jahren, und die Einstellungen weisen darauf hin. Die Unfallanzeigen (5 Jahre, DGUV Vorschrift 1 § 24 Abs. 6) sind damit ebenfalls abgedeckt. „Endgültig löschen“ im Archiv der Mitarbeiter-Seite beachtet die Fristen nicht (siehe oben). Stand 19.11.2026 |
| „Lohn und Steuer“ (nur ohne Lohnbüro: 6 Jahre) | Steuer-ID, Steuerklasse, Sozialversicherungsnummer, Krankenkasse, Bankverbindung, Konfession – wenn der Haken **„Lohnunterlagen bewahrt ein Lohnbüro/Steuerbüro auf“** fehlt, also die Einrichtung die Lohnunterlagen selbst aufbewahrt (Lohnkonto nach § 41 EStG, § 147 AO): löschbar ab dem 1. Januar nach dem Ende des 6. Jahres (ausgeschieden 2026 → ab 01.01.2033). Mit dem Haken (voreingestellt, wie bisher) gehören sie zu den „Persönlichen Daten“ |
| „BEM-Unterlagen“ (3 Jahre) | jedes BEM mit Gesprächen, Maßnahmen und Notizen – **anders als die anderen Fristen ab dem Ende des BEM** (abgeschlossen, abgelehnt, keine Antwort; Tag genau), auch bei Mitarbeitern, die noch da sind. Ein noch laufendes BEM zählt ab dem Austritt. Siehe Abschnitt 21, „BEM“ |
| „Betriebliche Altersvorsorge“ (30 Jahre) | nur zur Information, die App speichert dazu nichts |
| zuletzt | der Mitarbeiter-Eintrag selbst (Name, Kürzel, Gruppe), sobald alle anderen Daten der Person gelöscht sind |

Wochenstunden und Aushilfen bleiben mit den Zeitdaten, weil das Stundenkonto und der Dienstplan sie brauchen: So steht
die Person nach dem Ausscheiden weiter im Dienstplan und Stundenkonto ihrer letzten Monate.

**Zugang nach dem Ausscheiden:** Ab dem Tag nach „ausgeschieden am“ kann sich eine Leitung oder ein Mitarbeiter
**nicht mehr anmelden** – die App sagt „Dieser Zugang ist gesperrt, weil die Person ausgeschieden ist.“, und wer gerade
angemeldet ist, wird abgemeldet. Das gilt sofort, auch wenn noch nichts gelöscht ist. Gelöscht wird das Konto erst,
wenn der Träger die Zeile „‹Name› – Persönliche Daten“ unter **Mehr → Löschfristen** löscht. Wird das Ausscheiden
zurückgenommen (Datum entfernt oder in die Zukunft verschoben), geht die Anmeldung wieder. Ein **Träger-Konto** wird
nie gesperrt.

- Die Fristen stellt der **Träger** je Einrichtung unter *Einstellungen → Personal → Löschfristen* ein (1 bis 40 Jahre;
  „Einstellungen für“ geht auch hier). Die Leitung sieht sie dort nur. Dort stehen auch „Mitarbeiter endgültig
  löschen“ (siehe oben) und die „Aufbewahrungsfrist Kasse“ (1 bis 30 Jahre, voreingestellt 10).
- **„Lohnunterlagen bewahrt ein Lohnbüro/Steuerbüro auf“** (je Einrichtung, nur der Träger; voreingestellt an): Rechnet
  ein Lohn- oder Steuerbüro ab und bewahrt es die Lohnunterlagen auf, darf „Lohn und Steuer“ schon am Tag nach dem
  Ausscheiden gelöscht werden (wie bisher, mit den „Persönlichen Daten“ in einer Zeile). Ohne Haken bleiben diese Angaben
  6 Jahre nach dem Ende des Austrittsjahres und stehen dann auf der Seite „Löschfristen“ als eigene Zeile
  „‹Name› – Lohn und Steuer“ zum Löschen bereit. Wird der Haken später gesetzt, gehen schon aufbewahrte Angaben wieder
  mit den „Persönlichen Daten“.
- Eine geänderte Frist gilt sofort für die Seite „Löschfristen“. Schon Gelöschtes kommt nicht zurück.
- Im Abschnitt „Ausgeschiedene Mitarbeiter“ steht bei jeder Person, ab wann was gelöscht werden darf („Persönliche
  Daten dürfen schon gelöscht werden (vom Träger unter Mehr → Löschfristen). Zeitdaten dürfen ab … gelöscht werden,
  Beurteilungen ab …, ausgezahlte Überstunden ab …; danach der Eintrag.“). Hat die Person keine Buchung mit
  „ausgezahlt“, fehlt dieses Datum. Sind alle Fristen abgelaufen, steht dort, dass der Träger die Daten unter
  Mehr → Löschfristen löscht und zuletzt den Eintrag.
- Wird das Ausscheiden zurückgenommen (Datum entfernt oder in die Zukunft verschoben), verschwindet die Person von der
  Seite „Löschfristen“.
- Die Fristen sind vorbelegt nach den Vorgaben des Trägers – bitte im Zweifel mit Steuerberatung bzw. Datenschutz
  klären. Gelöschtes steckt noch in älteren Sicherungen (siehe Abschnitt 8, „Gelöschte Daten und Sicherungen“).

### Die Seite „Löschfristen“ (nur Träger)

- Unter **Mehr → Löschfristen** sieht der Träger alles, was nach Ablauf einer Frist gelöscht werden darf – aus
  **allen Einrichtungen** auf einer Seite: die Daten ausgeschiedener Mitarbeiter (je Art eine Zeile: Persönliche
  Daten, Zeitdaten, Beurteilungen, ausgezahlte Überstunden, zuletzt der Mitarbeiter-Eintrag), die Akten abgemeldeter
  Kinder und archivierte Kassen. Eine Zeile steht nur da, wenn es dazu noch Daten gibt. Die Leitung hat die Seite nicht.
- „Persönliche Daten“ (Geburtstag, PIN, Benutzerkonto …) sind ab dem Tag nach dem Ausscheiden löschbar. Das Konto einer
  Leitung oder eines Mitarbeiters ist ab diesem Tag schon gesperrt; mit dieser Zeile löschst du es.
- Je Zeile: Einrichtung, was (Name und Art der Daten) und **löschbar ab**. Mit **„Einrichtung“** oben zeigst du nur
  eine Einrichtung.
- **„Jetzt löschbar“** sind die Zeilen, deren Tag erreicht ist, je mit **„Löschen“**. Jedes Löschen fragt vorher nach;
  bei einer Kasse tippst du wie früher ihren Namen ein. **Lade vorher eine Datensicherung herunter** – gelöscht ist
  gelöscht.
- **„Alle fälligen löschen“** löscht genau die Zeilen, die gerade unter „Jetzt löschbar“ stehen (mit dem Filter nur
  die der gewählten Einrichtung). Die Rückfrage zählt auf, wie viele es je Art sind (z. B. „3 × Mitarbeiterdaten,
  1 × Kinderakte“). Der Mitarbeiter-Eintrag einer Person wird erst löschbar, wenn alles andere von ihr gelöscht ist –
  er steht dann beim nächsten Mal unter „Jetzt löschbar“.
- **„Später löschbar“** zeigt die übrigen Zeilen nach Datum, ohne Knopf.
- Solange etwas löschbar ist, steht beim Träger im Kasten **„Erinnerungen“** (Seite „Kinder“) „‹n› Einträge dürfen
  gelöscht werden“ mit einem Link auf die Seite.

### Die Seite einer Person

Ein Tipp auf den Namen öffnet die Seite der Person. Sie ist in sechs Reiter aufgeteilt, jeder mit einem oder mehreren
Abschnitten (auf dem Handy untereinander):

- **Stammdaten:** die Stammdaten (Name, Kürzel, ausgeschieden am, Gruppe, Geburtstag; mit Recht auch die persönlichen
  Daten der Personalakte), Notfallkontakte, Qualifikation (Personalschlüssel) und beim Träger „in andere Einrichtung
  verschieben“.
- **Vertrag & Lohn:** Stundenkonto heute und am Ende eines wählbaren Monats, Wochenstunden, Stundenkonto-Buchungen,
  Vertragsangaben und **Lohn und Steuer** (Personalakte, nur mit dem Recht dafür, siehe unten).
- **Urlaub & Zeiten:** Urlaubskonto eines wählbaren Jahres (Anspruch, Übertrag, genommen, verplant, frei verfügbar),
  Urlaubsanspruch, PIN und Zeiterfassung.
- **Nachweise:** Pflichttermine, Fortbildungen und **Dokumente** (Personalakte, nur die Fächer, für die du das Recht
  hast, siehe unten).
- **Gespräche** und **Zugang**.

Einen Reiter, von dem du keinen Abschnitt sehen darfst, gibt es für dich nicht. Die App merkt sich keinen Reiter; sie
öffnet immer mit „Stammdaten“, außer ein Link führt direkt zu einem Reiter oder Abschnitt (z. B. aus dem Hinweis auf
Pflichttermine oder aus „Was noch fehlt“). Was du in einem Reiter eingibst, bleibt beim Wechsel in einen anderen Reiter
stehen. **Jeder Abschnitt hat sein eigenes Speichern, und das speichert nur seine Felder** – Eingaben in einem anderen
Abschnitt oder Reiter werden dabei nicht mitgespeichert und auch nicht gelöscht. Gibt es noch nicht gespeicherte
Änderungen, fragt die App vor dem Wechsel des Reiters nach.

### Pflichttermine: Betriebsarzt und Belehrung Infektionsschutz

Die vorgegebenen Pflichttermine (*Einstellungen → Einrichtung → Pflichttermine*) sind Betriebsarzt, Erste-Hilfe-Kurs,
Erweitertes Führungszeugnis, Masernimpfung (Nachweis), Erst- und Nachuntersuchung nach dem JArbSchG (siehe
„Jugendarbeitsschutz“) und **„Belehrung Infektionsschutz (§ 34 Abs. 5a IfSG)“**.

- **Betriebsarzt** (arbeitsmedizinische Pflichtvorsorge wegen biologischer Arbeitsstoffe in der Kita, ArbMedVV Anhang
  Teil 2 Abs. 1 Nr. 3 Buchst. f, AMR 2.1): die **erste vor dem ersten Arbeitstag** (höchstens 3 Monate vorher), die
  **zweite spätestens 12 Monate nach Aufnahme der Tätigkeit**, danach **spätestens alle 36 Monate**. In den
  Einstellungen steht dafür „der zweite [12] Monate nach Arbeitsbeginn, dann alle [36] Monate“; beides lässt sich
  ändern (die Werte sind Höchstwerte, die Betriebsärztin oder der Betriebsarzt kann kürzere festlegen). Mit dem Häkchen
  **„Zweiter Termin ab Arbeitsbeginn“** schaltest du diese Regel für eine Art ein oder aus (ohne Häkchen gilt nur „alle
  [36] Monate“).
  - So rechnet die App: Arbeitsbeginn ist „beschäftigt seit“ (sonst die ersten Wochenstunden). Zu dieser Beschäftigung
    zählen nur Vorsorgen ab 3 Monaten vor dem Arbeitsbeginn. Ist genau eine davon eingetragen und liegt sie vor dem Ende
    der ersten 12 Monate, ist es die erste: die zweite ist **12 Monate nach dem Arbeitsbeginn** fällig. Liegen alle
    eingetragenen Vorsorgen mehr als 3 Monate vor dem Arbeitsbeginn, zählt keine davon als erste (AMR 2.1): Die Vorsorge
    ist **zum Arbeitsbeginn** fällig und steht vorher wie eine fehlende im Hinweis („noch kein Eintrag“). Sonst – ab der
    zweiten Vorsorge dieser Beschäftigung, oder wenn die einzige später liegt – ist die nächste **36 Monate nach der
    neuesten** fällig.
  - **Für schon länger Beschäftigte** reicht es also, die letzte Vorsorge einzutragen: die nächste ist 36 Monate später
    fällig.
  - Beim Update wurde der Abstand nur dort auf „12, dann 36“ umgestellt, wo noch die alte Vorgabe 24 Monate stand; ein
    selbst gewählter Abstand blieb (das Häkchen kann man dort selbst setzen).
- **Belehrung Infektionsschutz (§ 34 Abs. 5a IfSG):** vor dem ersten Arbeitstag, danach mindestens alle 2 Jahre (24
  Monate). Das Protokoll bewahrt der Arbeitgeber 3 Jahre auf. Beim Update bekam jede Einrichtung diese Art dazu (eine
  eigene Art mit genau diesem Namen wurde zur vorgegebenen). **Für alle, die schon da sind, steht sie danach als „noch
  kein Eintrag“ im Hinweis, bis die letzte Belehrung eingetragen ist.** Wer die Belehrung schon unter einem eigenen
  Namen geführt hat (z. B. „Infektionsschutzbelehrung“ oder „Belehrung § 35 IfSG“, die frühere Fundstelle): die
  Einträge bei der neuen Art nachtragen und die eigene Art löschen. Gibt es neben der vorgegebenen eine eigene Art mit
  „Belehrung“ im Namen, sagt das ein Hinweis in den Einstellungen.
- **Schon vor dem ersten Arbeitstag:** Betriebsarzt und Belehrung erscheinen für neue Mitarbeitende schon 3 Monate vor
  „beschäftigt seit“ (sonst vor den ersten Wochenstunden) im Hinweis, fällig zum ersten Arbeitstag. Eine Vorsorge vor
  dem ersten Arbeitstag trägst du mit ihrem Datum ein.

Quellen: ArbMedVV mit Anhang, AMR 2.1 (Fristen der Pflichtvorsorge); § 34 Abs. 5a IfSG. Stand 19.11.2026.

### Notfallkontakte

Im Reiter **Stammdaten** steht unter den Stammdaten der Abschnitt **„Notfallkontakte“**: wen ihr anruft, wenn der
Person im Dienst etwas passiert. Je Kontakt: **Name** und **Telefon** (beides Pflicht), **Beziehung** (z. B. „Ehemann“,
„Mutter“), **Telefon 2** und ein **Hinweis** (z. B. „nur abends erreichbar“). Mit den Pfeilen ↑↓ legst du die
Reihenfolge fest – **der erste Kontakt wird zuerst angerufen**. Sehen und ändern können die Notfallkontakte nur
**Leitung und Träger**; Mitarbeiter sehen nur die eigenen (schreibgeschützt, unter „Meine Termine“), das Tablet
zeigt sie nur mit Zustimmung (siehe unten). **„Notfallkontakte
drucken“** (oben auf der Seite *Mitarbeiter* und im Abschnitt selbst) öffnet die Liste **„Notfallkontakte aller
Mitarbeiter“** (A4 hochkant): alle, die nicht ausgeschieden sind, in der Reihenfolge der Mitarbeiter-Liste, je mit
ihren Kontakten in der Anruf-Reihenfolge – wer keinen hat, steht mit „keine Notfallkontakte erfasst“ darin. Nach dem
Ausscheiden gehören die Notfallkontakte zu den **„Persönlichen Daten“** (löschbar ab dem Tag nach dem Ausscheiden,
siehe „Löschfristen“).

#### Notfallkontakte am Tablet nur mit Zustimmung

Am Kita-Tablet sehen die Kolleginnen und Kollegen die Notfallkontakte einer Person **nur, wenn diese zugestimmt hat**
(voreingestellt: nein). Die Liste **„Notfallkontakte Team“** erscheint erst nach dem Aufschließen mit Name und PIN (wie
die Kinderdaten, mit derselben Sperrzeit): als Kachel unter „Kinder“ und als Knopf in der Leiste oben auf jeder
aufgeschlossenen Seite. Sie zeigt nur Mitarbeiter der Einrichtung, die nicht ausgeschieden sind und mindestens einen
Kontakt haben: Name, Kontakt, Beziehung und Telefonnummern zum Antippen – **nie den Hinweis**, nichts anderes.
Ein Widerruf gilt sofort. Es wird nicht festgehalten, wer die Liste geöffnet hat.

- **Mitarbeiter mit Konto** schalten unter **„Meine Termine“ → „Notfallkontakte am Tablet“** den Schalter „Meine
  Notfallkontakte am Kita-Tablet zeigen“ selbst ein und aus; darunter sehen sie, welche Kontakte dann angezeigt würden.
- **Leitung und Träger** tragen im Abschnitt „Notfallkontakte“ der Person ein: **„Zustimmung liegt schriftlich vor am
  ‹Datum›“** (für Personen ohne Konto oder wenn die Zustimmung auf Papier gegeben wurde; das Datum darf nicht in der
  Zukunft liegen) und bei Bedarf **„Widerruf schriftlich eintragen“**. Hat die Person selbst in der App zugestimmt, steht
  dort „Zugestimmt am ‹Datum› (selbst)“ ohne Änderungsmöglichkeit: nur die Person selbst nimmt das zurück.
- **Der Widerruf der Person gilt immer:** Hat sie in der App widerrufen, kann die Leitung die Zustimmung nicht wieder
  einschalten, sondern nur eine **neue schriftliche Zustimmung mit einem späteren Datum** als dem Widerruf eintragen
  (am Tag des Widerrufs selbst also noch nicht).
- Jede Zustimmung und jeder Widerruf steht mit Wer und Wann in einem **Protokoll**, das nie geändert wird. Es wird mit der
  Person gelöscht (Löschfristen, „Sofort“, mit den Notfallkontakten).

### Personalakte

Die Seite einer Person ist zugleich ihre **digitale Personalakte**. Was jemand davon sieht, hängt an eigenen Rechten;
fehlt das Recht, schickt der Server die Daten gar nicht erst (sie sind also auch nicht im Seitenquelltext).
Voreingestellt gilt:

| Teil | Wo | Träger | Leitung | Mitarbeiter, Tablet |
|---|---|---|---|---|
| Geburtsjahr (mit dem Geburtstag das volle Geburtsdatum), Anschrift (Straße, PLZ, Ort), Telefon, E-Mail | Reiter **Stammdaten**, Abschnitt „Persönliche Daten“ | ja | ja | nein |
| Staatsangehörigkeit, Schwerbehinderung (ja/nein, Grad der Behinderung 20–100, „gleichgestellt“, gültig bis) | Reiter **Stammdaten**, Abschnitt „Staatsangehörigkeit und Schwerbehinderung“ | ja | nein | nein |
| „befristet bis“, „Probezeit bis“ | Reiter **Vertrag & Lohn**, Vertragsangaben | bearbeiten | wie unter *Rechte und Rollen* eingestellt (Grundeinstellung: nein; „Vertragsangaben ansehen“ = nur lesen, „Vertragsangaben bearbeiten“ = auch ändern) | nein |
| Steuer-ID, Steuerklasse, Sozialversicherungsnummer, Krankenkasse, IBAN, Kontoinhaber, Konfession (Kirchensteuer) | Reiter **Vertrag & Lohn**, Abschnitt „Lohn und Steuer“ | ja | nein | nein |
| Dokumente im Fach „Qualifikationen und Fortbildungen“ | Reiter **Nachweise**, Abschnitt „Dokumente“ | ja | ja | nein |
| Dokumente in den Fächern „Vertrag und Nachträge, Stellenbeschreibung“, „Bewerbung“, „Korrespondenz“, „Arbeitsrechtliche Maßnahmen“, „Gehalt“ | Reiter **Nachweise**, Abschnitt „Dokumente“ | ja | nein | nein |

Mitarbeiter sehen nichts davon – auch nicht ihre eigene Akte; am Tablet und auf den „Mein …“-Seiten steht nichts davon.
Am Tablet bleibt der Geburtstag **ohne Jahr** als Erinnerung.

- **Stammdaten:** Das Geburtsjahr steht neben Tag und Monat des Geburtstags; daneben erscheint das volle Geburtsdatum
  (TT.MM.JJJJ). „Speichern“ speichert die persönlichen Daten zusammen mit den Stammdaten. PLZ (5 Ziffern) und E-Mail
  werden auf ihr Format geprüft; der Hinweis steht am Feld.
- **Lohn und Steuer:** Steuer-ID und Sozialversicherungsnummer zeigen nur die letzten 3 Zeichen, die IBAN nur Länderkennung
  und die letzten 4 (z. B. „DE•• •••• •••• •••• •• 3000“), Steuerklasse und Konfession sind ganz verdeckt.
  **„anzeigen“** beim Wert (oder **„Alle anzeigen“**) zeigt den vollen Wert; beim Verlassen des Reiters ist wieder alles
  verdeckt. **„Bearbeiten“** öffnet das Formular; hast du dort etwas geändert und willst in einen anderen Reiter, fragt
  die App vorher (danach ist das Formular geschlossen und die Änderung verworfen). Geprüft werden die IBAN (Prüfziffer), die Steuer-ID (11 Ziffern mit Prüfziffer), die
  Sozialversicherungsnummer (12 Zeichen mit Prüfziffer) und die Steuerklasse (1–6); ein falscher Wert lässt sich nicht
  speichern, der Hinweis steht am Feld. Ein leeres Feld ist immer erlaubt. Die Werte werden erst geladen, wenn du den
  Reiter **Vertrag & Lohn** öffnest.
- **Dokumente:** Je Fach ein Abschnitt mit **„Hochladen“**: PDF, JPG oder PNG bis 30 MB, dazu Titel, Datum und eine
  freiwillige Notiz. Je Dokument: Titel antippen oder ↗ öffnet es in einem neuen Tab, ⤓ lädt es herunter, der Stift
  ändert Titel, Datum, Notiz oder das Fach (zur Auswahl stehen nur Fächer, für die du das Recht hast), der Papierkorb
  löscht es nach einer Rückfrage. Gelöschte Dateien sind sofort aus der Datenbank entfernt (ältere Sicherungen enthalten
  sie noch, siehe Abschnitt 8).
- **Rechte:** Jeder Teil hat ein eigenes Recht („Anschrift, Kontakt und Geburtsdatum“, „Staatsangehörigkeit und
  Schwerbehinderung“, „Lohn und Steuer“ und je Fach „Dokumente: …“). Die Übersicht der Rechte unter *Benutzer* zeigt,
  wer was voreingestellt darf.
- **Löschfristen:** Nach dem Ausscheiden gehören Geburtsjahr, Anschrift, Kontakt, Staatsangehörigkeit,
  Schwerbehinderung, „befristet bis“, „Probezeit bis“ und – solange ein Lohnbüro die Lohnunterlagen aufbewahrt
  (voreingestellt) – alles aus „Lohn und Steuer“ zu den **„Persönlichen Daten“** (löschbar ab dem Tag nach dem
  Ausscheiden; ohne Lohnbüro bleibt „Lohn und Steuer“ 6 Jahre, siehe *Löschfristen*). Die Dokumente in den Fächern Bewerbung, Qualifikationen, Korrespondenz und Maßnahmen gehen
  mit den **„Beurteilungen“** (3 Jahre), die in den Fächern Vertrag und Gehalt mit den **„ausgezahlten Überstunden“**
  (voreingestellt 8 Jahre; auf der Seite „Löschfristen“ heißt die Zeile „ausgezahlte Überstunden, Verträge, Gehalt“). Gelöscht wird
  wie immer von Hand durch den Träger unter **Mehr → Löschfristen** (siehe oben).

### Probezeit und Entgeltgruppe

- **„Probezeit bis“** (Reiter **Vertrag & Lohn**, Vertragsangaben; der Träger trägt es ein, sehen darf es, wer die
  Vertragsangaben sieht): der letzte Tag der Probezeit. Ist das Feld leer und „In der Einrichtung seit“ eingetragen,
  schlägt die App einen Tag vor – sechs Monate minus einen Tag (01.03. → 31.08.), bei Auszubildenden (Qualifikation
  „Azubi“) vier Monate minus einen Tag (§ 20 BBiG). Der Vorschlag steht nur im Feld und wird erst mit „Speichern“
  übernommen; du kannst ihn ändern. Bei bestehenden Personen, deren Probezeit nach dem Vorschlag schon vorbei wäre,
  bleibt das Feld leer.
- **Hinweise** (gelb, speichern geht trotzdem): länger als 6 Monate (die kürzere Kündigungsfrist gilt höchstens 6
  Monate, § 622 Abs. 3 BGB); bei Auszubildenden länger als 4 Monate oder kürzer als 1 Monat (§ 20 BBiG); Ende vor dem
  Eintritt.
- **Erinnerung:** 4 Wochen vor dem Ende erscheint im Kasten „Erinnerungen“ (Seite *Kinder*) **„Probezeit von ‹Name›
  endet am ‹TT.MM.JJJJ›“** mit „zum Vertrag“ – für den Träger und für die Leitung, wenn sie die Vertragsangaben sieht
  (nicht am Tablet), bis einschließlich zum letzten Tag. Wer vorher ausscheidet, wird nicht erinnert.
- **Löschen:** „Probezeit bis“ gehört zu den Vertragsangaben und geht mit den „Persönlichen Daten“.
- **Entgeltgruppe S 10:** Seit dem 01.05.2026 steht S 10 nicht mehr in der Tabelle des TVöD SuE (S 5 und S 6 gibt es
  ebenfalls nicht). Neu wählen lässt sich S 10 nicht mehr. Ist bei einer Person noch S 10 gespeichert, bleibt der Wert
  stehen und wird als **„S 10 (nicht mehr in der Tabelle)“** angezeigt; beim Speichern anderer Angaben bleibt er
  unverändert, bis der Träger eine andere Entgeltgruppe wählt.

### Gesetzlicher Mindesturlaub (nur ein Hinweis)

Beim **Anlegen eines Mitarbeiters** und unter **„Urlaub & Zeiten“ → Urlaubsanspruch** (je Jahr, auch beim Eintragen)
zeigt die App den **gesetzlichen Mindesturlaub** nach dem Bundesurlaubsgesetz an; liegt der eingetragene Anspruch (ohne
Übertrag) darunter, erscheint ein gelber Hinweis. Eingetragen wird nichts. Rechnung: 24 Werktage bei einer 6-Tage-Woche,
also **24 × Arbeitstage pro Woche ÷ 6** (5 Tage → 20, 4 → 16, 3 → 12); bei **Schwerbehinderung** (nur wer die
Personalakte-Angaben sehen darf, nicht bei „gleichgestellt“ – § 151 Abs. 3 SGB IX) **5 Tage je 5-Tage-Woche** mehr.
Endet die Schwerbehinderung im Jahr („gültig bis“), gibt es den Zusatzurlaub nur zu **1/12 je vollem Monat** der
Schwerbehinderung im Arbeitsverhältnis, gezählt ab 1. Januar bzw. ab Eintritt bis „gültig bis“ bzw. bis zum Ausscheiden
(§ 208 Abs. 2 SGB IX; ab einem halben Tag wird aufgerundet, ein kleinerer Rest bleibt; dieser Teil wird nicht noch
einmal gezwölftelt). Beispiel: gültig bis 31.03., 5-Tage-Woche → 20 + 1,25 Tage. Grenze: Der **Beginn** der
Schwerbehinderung wird nicht gespeichert – die App nimmt an, dass sie schon vor dem Jahr (bzw. seit Eintritt) bestand.
Beginnt sie im Jahr, bitte den Anspruch selbst nachrechnen (Stand der Regel: 19.11.2026). „Gültig bis“ ist das Ende der
Schwerbehinderung laut Bescheid, nicht nur der Ablauf des Ausweises: Der Schutz endet erst mit einem Bescheid und gilt
bis zum Ende des dritten Monats danach (§ 199 Abs. 1 SGB IX); bei Verlängerung das neue Datum eintragen (Hinweis auch am
Feld). Die Arbeitstage stammen
aus dem Wochenstunden-Eintrag, der am 1. Januar gilt (bei Eintritt im Jahr: am Eintrittstag). Nach sechs Monaten
Beschäftigung (Wartezeit) gilt der volle Jahresurlaub, also auch bei Eintritt bis zum 1. Juli und bei Ausscheiden nach
erfüllter Wartezeit ab dem 1. Juli. **1/12 je vollem Beschäftigungsmonat** (gezählt ab dem Eintrittstag, z. B.
15.7.–14.8.) gibt es nur bei Eintritt nach dem 1. Juli, bei Ausscheiden vor Ende der Wartezeit und bei Ausscheiden bis
zum 30. Juni. Ein Rest von mindestens einem halben Tag wird auf einen ganzen Tag aufgerundet, ein kleinerer bleibt
stehen (Eintritt 1. August: 8,33 Tage). Das ist **keine Rechtsberatung**; Tarifvertrag oder Arbeitsvertrag geben meist
mehr (TVöD: 30 Tage bei einer 5-Tage-Woche, **ab 2027 31 Tage** nach der Tarifeinigung vom 06.04.2025).

**Vorschlag nach TVöD:** Beim Anlegen steht im Feld „Urlaubstage“ der TVöD-Urlaub als Platzhalter, darunter der Satz
„Vorschlag nach TVöD für ‹Jahr›: … Tage pro Jahr“; unter „Urlaubsanspruch“ ist das Feld „Tage“ damit vorbelegt (beim
Wechsel des Jahres wandert der Vorschlag mit, solange du ihn nicht geändert hast). Gerechnet wird mit 30 Tagen (bis
2026) bzw. 31 Tagen (ab 2027) für 5 Arbeitstage pro Woche, umgerechnet auf die Arbeitstage der Person (§ 26 Abs. 1
TVöD; ein Rest ab einem halben Tag wird aufgerundet, ein kleinerer fällt weg: 4 Tage → 24 bzw. 25, 3 Tage → 18 bzw.
19). Das gilt mit und ohne den Schalter „Wir arbeiten nach TVöD SuE“. Gespeicherte Ansprüche ändern sich nicht von
selbst: Für 2027 trägst du die 31 Tage selbst ein.

### TVöD SuE, Heiligabend und Silvester

Unter **Einstellungen → Dienstplan → „TVöD, Heiligabend und Silvester“** legt der **Träger je Einrichtung** fest
(„Einstellungen für“ wählt die Einrichtung; die Leitung sieht die Einstellung nur):

- **„Wir arbeiten nach TVöD SuE“** (voreingestellt an, auch für schon bestehende Einrichtungen): Der 24.12. und der
  31.12. sind **bezahlt frei** (TVöD § 6 Abs. 3). Diese Tage kosten keinen Urlaub und zählen für die Mitarbeiter der
  Einrichtung wie ein Feiertag: keine Sollstunden (das Stundenkonto ändert sich entsprechend), im Dienstplan als
  „Heiligabend (bezahlt frei)“ bzw. „Silvester (bezahlt frei)“ markiert, Schließzeiten verbrauchen an diesen Tagen
  keinen Urlaub, Wochenvorlagen lassen sie aus. Die **Besetzungs-Warnungen bleiben** an diesen Tagen: Der TVöD stellt
  nur frei, „soweit die dienstlichen Verhältnisse es zulassen“ – hat die Kita geöffnet, muss der Dienstplan stimmen
  (wer dann arbeitet, bekommt die Stunden als Plus; ist die Kita zu, eine Schließzeit oder einen Schließtag
  eintragen). Unter „Der 24.12. und der 31.12. zählen als“ steht dann fest „bezahlt frei (TVöD § 6 Abs. 3)“. Sonst
  ändert der Schalter **nichts**: Entgeltgruppe, Stufe und Stufenaufstieg bleiben in beiden Fällen sichtbar und nutzbar
  (viele arbeiten „in Anlehnung“ an den TVöD).
- **Ohne den Schalter** wählt die Einrichtung selbst: **ganzer Urlaubstag** (wie früher voreingestellt), **halber
  Urlaubstag** oder **bezahlt frei** (wirkt wie der Schalter). Mit „halber Urlaubstag“ zählt so ein Tag überall 0,5: im
  Urlaubskonto (genommen, verplant, frei verfügbar, Übertrag ins nächste Jahr), beim Resturlaub in der
  Mitarbeiterliste, im Reiter „Urlaub & Zeiten“, in „Mein Urlaub“, bei Urlaubsanträgen (Tage, „danach noch …“) und beim
  Buchen von Schließzeiten für neu Eingestellte; Stundenkonto und Sollstunden ändern sich dabei nicht, in der
  Urlaubsplanung zählt die Person an dem Tag weiter als eine Person im Urlaub. Die Wahl bleibt gespeichert, während der
  Schalter an ist.

**Jede Änderung gilt erst ab einem Jahr, frühere Jahre ändern sich nie.** Die App merkt sich je Einrichtung, wie der
24.12. und der 31.12. in welchem Jahr zählen. Wer den Schalter umlegt oder die Wahl ändert, ändert das ab dem
**laufenden Jahr** – ab dem 24.12. erst ab dem **nächsten Jahr** (der 24.12. des laufenden Jahres ist dann schon da).
Neben dem Schalter (ohne TVöD neben der Wahl) steht, ab wann die aktuelle Regel gilt („gilt ab 2026“), darunter die
Regel der Jahre davor (zum Beispiel „Bis 2025: ganzer Urlaubstag.“). Zählen die Jahre davor schon so, wie neu
eingestellt, merkt sich die App dafür kein neues Jahr. Urlaub, Sollstunden und Stundenkonto früherer Jahre bleiben also, wie sie
sind – auch wenn „bezahlt frei“ später wieder ausgeschaltet wird: Dann bleiben die bisher bezahlt freien Jahre bezahlt
frei. Beim Einspielen dieser Version gilt für schon bestehende Einrichtungen bis 2025 die bisherige Einstellung (ganzer
oder halber Urlaubstag) und ab 2026 „bezahlt frei“; neu angelegte Einrichtungen sind ab dem Jahr bezahlt frei, in dem
sie angelegt werden.

**Schon eingetragener Urlaub am 24.12./31.12.2026:** Urlaub, der vor dem Einspielen dieser Version an diesen Tagen
eingetragen war (auch aus Schließzeiten oder genehmigten Anträgen), bleibt im Dienstplan sichtbar, zählt aber ab jetzt
**0 Urlaubstage** (die Tage sind bezahlt frei). Wer ihn nicht mehr sehen will, entfernt ihn im Dienstplan.

Es gilt die Einstellung der **Stammeinrichtung** der Person. Hört „bezahlt frei“ ab einem Jahr auf (Schalter aus,
ganzer oder halber Urlaubstag), bucht die App vorhandene Schließzeiten an diesen Tagen ab diesem Jahr nach, wie beim
Wechsel des Bundeslands; frühere Jahre bleiben unberührt.
Keine gesetzlichen Feiertage sind die beiden Tage trotzdem: Die Anwesenheit und die Betreuungstage der Kinder, der
Personalschlüssel-Bericht, die Besetzungs-Warnungen im Dienstplan, Mutterschutz- und Jugendarbeitsschutz-Hinweise
rechnen sie weiter als normale Tage.

### Zusatztag nur für dieses Jahr

Unter **„Urlaub & Zeiten“ → Urlaubsanspruch** gibt es den Knopf **„Zusatztag nur für dieses Jahr“**: Jahr (voreingestellt
das laufende), Tage (voreingestellt 1; halbe Tage möglich, 0,5 bis 30) und eine **Begründung** (Pflicht, höchstens
200 Zeichen, z. B. „Dank für Sommerfest“). Darunter stehen alle Zusatztage, z. B. „2026: + 1 Tag – Dank für Sommerfest
(von ‹Name›, 20.11.2026)“, jeweils mit **Löschen** (mit Rückfrage). Hinzufügen und löschen darf genau, wer den
Urlaubsanspruch ändern darf (Recht „Mitarbeiter anlegen und pflegen“, nur in der eigenen Einrichtung; ein Mitarbeiter
mit diesem Recht nicht für sich selbst). Ein Zusatztag geht nur für ein Jahr, für das ein Urlaubsanspruch eingetragen ist
(auch ein aus einem früheren Jahr übernommener); sonst erscheint ein Hinweis. Für ein Jahr, das schon vorbei ist, sagt
der Dialog vor dem Speichern, dass der Übertrag in alle folgenden Jahre größer wird. Wird später der Urlaubsanspruch so
gelöscht, dass das Jahr keinen Anspruch mehr hat, nennt die Rückfrage die betroffenen Zusatztage; in der Liste steht
danach „zählt nicht – kein Urlaubsanspruch für ‹Jahr›“, bis wieder ein Anspruch eingetragen ist. Die **Begründung**
sehen die Person selbst und alle, die die Urlaubsübersicht oder die Mitarbeiterseite sehen (anders als die Begründung
beim Sonderurlaub) – daher nichts Persönliches eintragen; der Dialog sagt das auch.

So wird gerechnet: Zusatztage erhöhen **nur den frei verfügbaren Urlaub ihres Jahres** (Anspruch des Jahres + Zusatztage
+ Übertrag − genommen − verplant). Der **Anspruch der folgenden Jahre ändert sich nicht**. Was am Jahresende übrig ist,
wird wie der übrige **Resturlaub** ins nächste Jahr übertragen (die automatische Übertragsrechnung sieht einfach mehr
verfügbaren Urlaub) und zählt beim **Hinweis auf Resturlaub (Verfall)** genauso wie der übrige Übertrag. Auch Schließzeiten als
Urlaub (Grenze für Eintritte im Jahr) und die Prüfung von Urlaubsanträgen rechnen mit den Zusatztagen.

Angezeigt werden sie überall, wo der Anspruch des Jahres steht: im Urlaubskasten der Mitarbeiterseite („Anspruch 30
+ 1 Zusatztag“, darunter die Begründung), unter **„Mein Urlaub“** (eigene Kachel „Zusatztage“ und die Begründungen – die
Person sieht, wofür), in der **Urlaubsplanung → „Alle Anträge und Urlaube“** und deren Druck („Anspruch 30 + 1 Zusatztag
(Dank für Sommerfest) + Übertrag …“) sowie in der Vorschau „Schließzeiten als Urlaub“ („Bei 31 Urlaubstagen bleiben …“).
Gelöscht werden sie mit den Urlaubsansprüchen (Löschfrist „Sonstige Überstunden- und Zeitdaten“).

### Hinweis auf Resturlaub (Verfall)

Der Arbeitgeber muss jeden Mitarbeiter rechtzeitig auf seinen Resturlaub hinweisen und darauf, dass er sonst verfällt
(Bundesurlaubsgesetz, Rechtsprechung des Bundesarbeitsgerichts). Dafür gibt es unter **Einstellungen → Dienstplan →
„Hinweis auf Resturlaub“** je Einrichtung (Leitung und Träger):

- **„Resturlaub verfällt am“**: Tag und Monat im Folgejahr, voreingestellt 31.03. (erlaubt zwischen 1. Januar und
  30. September).
- **Text des Hinweises** mit den Platzhaltern ‹Tage›, ‹Jahr› und ‹Verfall›. Ein eigener Text muss ‹Tage› und
  ‹Verfall› enthalten, sonst lässt er sich nicht speichern; „Standardtext einsetzen“ stellt den vorgegebenen Text her.

Vom **1. Oktober** bis zum Verfallsdatum im Folgejahr sehen alle Mitarbeiter mit eigenem Zugang und Resturlaub aus dem
Jahr den Hinweis unter „Mein Urlaub“ und auf ihrer Startseite, bis sie **„Gelesen“** klicken. Gespeichert wird, wann
sie gelesen haben, mit den genannten Tagen und dem genauen Text; diese Einträge werden nicht mehr geändert. Bis zum
31.12. zählt, was im Jahr noch frei verfügbar ist, danach der Übertrag, der bis zum Verfallsdatum weder genommen noch
eingeplant ist. Werden es später **mehr Tage** als gelesen (z. B. nach einer Korrektur des Anspruchs) oder ändert die
Einrichtung **Verfallsdatum oder Text**, erscheint der Hinweis noch einmal und es kommt ein weiterer Eintrag dazu
(der alte bleibt). Weniger Tage zeigen ihn nicht noch einmal. Auch wer **vor dem Verfallsdatum ausscheidet**, bekommt
den Hinweis, solange er noch beschäftigt ist.

Auf der Seite **„Urlaubsplanung“** (für alle mit der Urlaubsübersicht, also Leitung und Träger, auch ohne
Urlaubsanträge) steht **„Hinweis auf Resturlaub ‹Jahr›“** mit Name, Tagen und Status: „gelesen am …“, „gelesen am …
(5 Tage) – jetzt 7 Tage, erneut offen“, „offen“ oder **„kein Konto – bitte schriftlich hinweisen“** (diese Personen
musst du auf Papier hinweisen). Vor dem 1. Oktober des Jahres steht dort nur, ab wann der Hinweis erscheint. Die Liste
lässt sich drucken (A4 hochkant). Die Einträge werden mit den Zeitdaten einer endgültig gelöschten Person gelöscht.

### Urlaubsanträge: Urlaub oder Überstundenfrei

Ist das Modul Urlaubsanträge aktiv, wählt man unter **„Mein Urlaub“** im Antrag oben **„Urlaub“** (voreingestellt) oder
**„Überstundenfrei“**. Beantragt werden immer **ganze Tage** (Arbeitstage ohne Feiertage, freie Tage und Schließzeiten).

- **Urlaub** nimmt Urlaubstage; die Vorschau zeigt „danach noch … Tage Urlaub“.
- **Überstundenfrei** nimmt **keine Urlaubstage**. Die Vorschau zeigt, wie viele Stunden der Antrag vom Stundenkonto
  nimmt (die Sollstunden der Tage; Tage, an denen schon Krank, Urlaub u. Ä. steht, kosten nichts) und
  **„Stundenkonto danach: …“**: der Stand heute minus dieser Antrag, andere offene
  Überstundenfrei-Anträge und schon eingetragenes Überstundenfrei nach heute. Ein Minus ist erlaubt; die Leitung
  entscheidet.
- In „Meine Anträge“ und in der Urlaubsplanung steht bei solchen Anträgen das Abzeichen **„Überstundenfrei“**.
  Genehmigen und Ablehnen gehen genau wie beim Urlaub (dieselben Zuständigen, dieselbe Zahl am Menü). Beim Genehmigen
  trägt das Programm **„ÜF“** statt „Urlaub“ in den Dienstplan ein; Tage mit Krank, Urlaub, Fortbildung u. Ä. bleiben
  unverändert.
- Für die **Höchstzahl gleichzeitig im Urlaub** zählt Überstundenfrei (eingetragen oder beantragt) wie Urlaub. Nur
  ein **halber Tag ÜF** zählt dort nicht mit: ÜF **mit Uhrzeit**, wenn am selben Tag auch ein Dienst der Person
  eingetragen ist – die Person ist an dem Tag ja da. Steht ÜF mit Uhrzeit allein in der Zelle, fehlt die Person den
  ganzen Tag und zählt mit. Anträge sind immer ganze Tage und zählen. Im Jahreskalender und in der Urlaubsplanung
  erscheint ÜF türkis als „Überstundenfrei“ (auch ÜF mit Uhrzeit).

### Urlaubsplanung: „Alle Anträge und Urlaube“ und offene Anträge im Jahreskalender

Wer Urlaub plant und genehmigt, sieht auf der Seite „Urlaubsplanung“ zwei Reiter: **„Planung“** (wie bisher) und
**„Alle Anträge und Urlaube“** (die Adresse merkt sich den Reiter). Oben stehen die Filter Jahr, Mitarbeiter, Art
(Urlaub, Sonderurlaub, ÜF) und Status (offen, genehmigt, abgelehnt, zurückgezogen, direkt eingetragen); gefiltert wird
auf dem Server, die Druckansicht (A4 quer) zeigt dasselbe.

- **Anträge**: jeder Antrag des Jahres (auch über den Jahreswechsel) mit Zeitraum, Tagen, Art, gestellt am, Status,
  entschieden von/am und Ablehnungsgrund. Offene Anträge lassen sich hier genauso genehmigen oder ablehnen wie unter
  „Planung“ (den eigenen Antrag entscheidet jemand anderes, der Träger auch seinen eigenen).
- **Urlaubstage**: je Person die Zeiträume des Jahres mit Tagen und Herkunft und darüber die Zeile Anspruch / genommen /
  verplant / frei verfügbar aus dem Urlaubskonto. Die Herkunft richtet sich **nach dem Datum**: Ein Urlaubstag
  (bzw. ÜF-Tag) innerhalb eines genehmigten Antrags derselben Art heißt **„Antrag genehmigt am …“**, auch wenn er
  später von Hand neu eingetragen wurde – das Programm merkt sich nicht, wer einen einzelnen Tag geschrieben hat.
  Überschneiden sich zwei genehmigte Anträge derselben Art, gehört ein Tag dem später gestellten Antrag, der ihn
  enthält; die übrigen Tage dem früheren. Alle anderen Tage heißen **„direkt eingetragen“**, Urlaub aus Schließzeiten
  **„Schließzeit ‹Bezeichnung›“** (nur die Tage im gewählten Jahr). Sonderurlaub ist immer „direkt eingetragen“.
- Mit dem Status „offen“, „abgelehnt“ oder „zurückgezogen“ gibt es keine Urlaubstage; „genehmigt“ zeigt nur Zeiträume
  aus Anträgen, „direkt eingetragen“ nur die übrigen. Schließzeiten erscheinen nur ohne Status-Filter.

Im **Jahreskalender** (Mehr → Kalender) sehen Leitung, Träger und wer Urlaub plant die **offenen Anträge** schraffiert
und heller als genehmigten Urlaub (grün Urlaub, türkis ÜF), mit dem Text „beantragt: …“ (Zeitraum, Tage, beantragt
am) als Tooltip und beim Anklicken des Tages. Genehmigte Anträge sind normaler Urlaub, abgelehnte und zurückgezogene
erscheinen nicht. Der Schalter **„Anträge zeigen“** (voreingestellt an) merkt sich jedes Gerät. Ist eine Höchstzahl
eingestellt, markiert die Zeile **„über Höchstzahl“** die Tage, an denen eingetragener Urlaub und offene Anträge
zusammen darüber liegen (Symbol und Zahl). Den Link **„Zur Urlaubsplanung“** sieht nur, wer dort auch planen darf.
Mitarbeiter sehen in ihrem Kalender keine Anträge anderer.

### Zugang (Benutzerkonto der Person)

- Im Reiter **Zugang** richtest du für eine Person ohne Konto mit **„Zugang einrichten“** ein Benutzerkonto ein: Der
  Benutzername ist aus dem Namen vorgeschlagen (klein, ohne Leerzeichen, ä/ö/ü/ß als ae/oe/ue/ss) und lässt sich
  ändern. Dazu ein Startpasswort (mindestens 8 Zeichen) und die Rolle **Mitarbeiter**, **Gruppenleitung** oder
  **Leitung**. Das Konto ist
  gleich mit der Person verknüpft; sie muss das Passwort bei der ersten Anmeldung ändern.
- Hat die Person schon ein Konto, siehst du dort Benutzername, Rolle und „aktiv“ und kannst das **Passwort
  zurücksetzen**. Es gelten dieselben Rechte wie unter *Benutzer*: Ein Träger-Konto kann nur ein Träger ändern.
- Darunter stehen die **Rechte der Person** (Abschnitt 26): beim Träger alle Schalter mit Ausnahmen, bei der Leitung für
  Mitarbeiter nur „Kinder: eintragen und Akten ändern“ (früher „darf Kinderakten pflegen“). Bei einer Gruppenleitung
  sieht die Leitung statt der Rechte den Hinweis „Die Rechte der Gruppenleitung stellt der Träger ein.“

### Die Seite *Benutzer*

Unter *Benutzer* stehen weiterhin **alle Konten**. Dort legst du vor allem Konten an, die zu keinem Mitarbeiter
gehören (Stempel-Tablet; der Träger auch Träger-Konten), und kannst die Konten ändern (Träger-Konten nur der Träger).
Die Rollen sind **Träger**, **Leitung**, **Gruppenleitung**, **Mitarbeiter** und **Stempel-Tablet**; Gruppenleitung und
Mitarbeiter brauchen einen verknüpften Mitarbeiter und arbeiten in dessen Einrichtung. Die Spalte **Rechte** öffnet die Rechte der
Person (wie im Reiter *Zugang*); bei einer Gruppenleitung steht dort für die Leitung „stellt der Träger ein“. Beim Träger führt oben ein Link zu
*Rechte und Rollen*; die Übersicht, was die Rollen gerade dürfen, ist zugeklappt: **„Rechte der Rollen anzeigen“** klappt
sie auf. Auf dem Handy lässt sich die Tabelle der Konten seitlich wischen.

### Stempel-PIN

- Mit der PIN stempelt jeder Mitarbeiter am Kita-Tablet und schließt dort die Kinder auf. Die PIN hat **genau
  6 Ziffern**. Leitung und Träger setzen sie unter *Mitarbeiter → Name → Urlaub & Zeiten* (nur für die Mitarbeiter der
  Einrichtung, in der sie gerade arbeiten).
- **Nach dem Update auf die 6-stellige PIN sind alle bisherigen 4-stelligen PINs gelöscht.** Bitte für jeden
  Mitarbeiter eine neue PIN setzen. In der Mitarbeiterliste steht bei allen ohne PIN **„PIN fehlt“**; wer keine PIN
  hat, steht auch nicht auf dem Tablet.
- **Sperre nach falschen Eingaben** (Stempeln und Aufschließen zählen zusammen):
  - Nach 5 falschen Eingaben ist die PIN **15 Minuten** gesperrt („PIN für 15 Minuten gesperrt.“).
  - Nach den nächsten 5 falschen Eingaben **30 Minuten** („PIN für 30 Minuten gesperrt.“).
  - Nach weiteren 5 falschen Eingaben bleibt sie gesperrt, bis die Leitung oder der Träger sie freischaltet („PIN
    gesperrt. Bitte die Leitung oder den Träger um Freischaltung.“).
  - Wer es während einer Sperre erneut versucht, sieht am Tablet, bis wann die PIN gesperrt ist („PIN gesperrt bis
    14:35.“).
  - Eine **richtige Eingabe** setzt alles zurück: Die nächste Sperre dauert wieder 15 Minuten.
- **Freischalten:** Auf der Seite des Mitarbeiters steht bei einer gesperrten PIN „PIN gesperrt bis 14:35.“ bzw.
  „PIN dauerhaft gesperrt – Freischaltung durch die Leitung oder den Träger nötig.“. Auch wenn eine Sperre schon
  abgelaufen ist, steht dort, wie viele Sperren es seit der letzten richtigen Eingabe gab und was die nächste bedeutet
  (z. B. „2 Sperren seit der letzten richtigen Eingabe – die nächste ist dauerhaft.“). Solange es mindestens eine
  Sperre gab, haben Leitung und Träger den Knopf **„PIN freischalten“**: Danach geht die PIN sofort wieder und die
  nächste Sperre dauert wieder 15 Minuten. Eine neue PIN setzen schaltet ebenfalls frei.
- **Aushilfen:** Wer sich als Aushilfe am Tablet einer anderen Einrichtung sperrt, wird von der **eigenen
  (Stamm-)Einrichtung** freigeschaltet – dort wird auch die PIN vergeben.

## 16. Erinnerungen

Auf der Seite **Kinder** steht oben im Bereich **„Heute“** (über den Reitern „Anwesenheit“ und „Wochenübersicht“)
der Kasten **„Erinnerungen“**: am Tablet, sobald es
aufgeschlossen ist, bei Leitung und Träger auf jedem Gerät. Mit dem eigenen Konto (Handy, privater PC) sehen
Mitarbeiter keine Erinnerungen – auch nicht die Geburtstage der Kollegen (die stehen aber als automatisches
Ereignis im Dienstplan und Jahreskalender, Abschnitt 17). Der Kasten lässt sich zuklappen; das
Gerät merkt sich, ob er zu- oder aufgeklappt ist. Gibt es nichts zu erinnern, ist er gar nicht da.

Die Einträge stehen in dieser Reihenfolge: überfällig, heute, dann nach Datum.

- **Entwicklungsdokumentation**: „Entwicklungsdoku für Lena Muster fällig am 12.11.“, am Tag selbst „… heute
  fällig“, danach rot „… überfällig seit 12.11.“, bis jemand **„Erledigt“** antippt. Liegt der Tag nicht im
  laufenden Jahr, steht das Jahr dabei („überfällig seit 03.04.2024“).
- **Elterngespräche**: nur am Tag des Gesprächs, den ganzen Tag: „Elterngespräch Lena Muster heute 14:00
  (Entwicklungsgespräch)“ – ohne „Erledigt“; am nächsten Tag ist der Eintrag weg (Abschnitt 8, „Elterngespräche“).
  Auch für Kinder, die noch nicht angefangen haben (Vertragskinder vor dem Eintritt, Vormerkungen): Mitarbeiter
  sehen sie nur für die zugesagte bzw. gewünschte Gruppe und nur, wenn das Tablet diese Kinder zeigt (Einstellung für
  Vormerkungen bzw. künftige Verträge); Leitung und Träger sehen alle. Ausgetretene Kinder nicht. Alle anderen
  Erinnerungen (Doku, Geburtstag, Abschied) gibt es nur für Kinder, die schon da sind.
- **Geburtstage der Kinder**: „Lena Muster wird am 12.11. 5 Jahre“, am Tag „Lena Muster hat heute Geburtstag (5)“.
- **Geburtstage der Mitarbeiter**: „Anna hat am 12.11. Geburtstag“, am Tag „Anna hat heute Geburtstag“ – ohne
  Jahr und ohne Alter. Ausgeschiedene Mitarbeiter stehen nicht da.
- **Abschied**: „Lena Muster verlässt uns am 31.07.“ – für Kinder mit eingetragenem Austritt und, wenn die
  automatische Abmeldung der Schulkinder eingeschaltet ist, für die Kinder, die sie abmelden wird. Ein Wechsel in
  eine andere Einrichtung geschieht in der App sofort und gibt keine Erinnerung.
- **Löschfristen** (nur der Träger, nicht am Tablet): „3 Einträge dürfen gelöscht werden“, solange auf der Seite
  **Mehr → Löschfristen** etwas aus irgendeiner Einrichtung löschbar ist; der Text führt dorthin (Abschnitt 15).
- **BEM anbieten** (wer das Recht für die Krankheitstage hat, also Leitung und Träger; nicht am Tablet, nie über sich
  selbst): „BEM anbieten: ‹Name› war in den letzten 12 Monaten ‹n› Arbeitstage krank (mehr als 6 Wochen, § 167 SGB IX)“
  mit „zum BEM“, solange kein BEM läuft; dazu „BEM-Einladung für ‹Name› noch nicht verschickt“ und „BEM ‹Name›:
  Antwortfrist abgelaufen – Antwort eintragen“, solange ein BEM wartet (Abschnitt 21, „BEM“).
- **Probezeit** (wer die Vertragsangaben sieht: der Träger, die Leitung mit „Vertragsangaben ansehen“; nicht am
  Tablet): „Probezeit von ‹Name› endet am ‹TT.MM.JJJJ›“ mit „zum Vertrag“, ab 4 Wochen vor dem letzten Tag der Probezeit
  bis einschließlich zu diesem Tag (Abschnitt 15, „Probezeit und Entgeltgruppe“).

Ist die aufschließende Person als Bezugserzieher des Kindes eingetragen, steht beim Eintrag **„dein Kind“**. Der
Name eines Kindes führt zu seiner Akte.

### Wer welche Kinder sieht

- Mitarbeiter mit Gruppe: die Kinder der **eigenen** Gruppe – nicht die Kinder einer Gruppe, die für sie nur zum
  Lesen freigeschaltet ist.
- **Kinder ohne Gruppe** sehen alle (wie im Gruppenbuch).
- Mitarbeiter ohne Gruppe, Aushilfen, Leitung und Träger: alle Kinder.
- Es zählen nur aktive Kinder (keine Vormerkungen, keine Ausgetretenen).

### Erledigt und Rückgängig

„Erledigt“ speichert das Datum und die Person (am Tablet die aufschließende Person, auch ohne eigenes Konto). Der
Eintrag verschwindet dann bis zur nächsten Fälligkeit. Pro Kind und Tag gibt es nur ein „Erledigt“: Tippt jemand
zweimal (oder tippen zwei Personen am selben Tag), bleibt es bei dem ersten Eintrag.

Erledigen dürfen:

- Mitarbeiter mit Gruppe: die Kinder der **eigenen** Gruppe und die Kinder ohne Gruppe – nicht die Kinder einer
  Gruppe, die für sie nur zum Lesen freigeschaltet ist (wie Eintragen in der Wochenübersicht),
- Mitarbeiter ohne Gruppe und Aushilfen: alle Kinder,
- Leitung und Träger: alle Kinder.

In der Kinderakte steht unter **„Entwicklungsdokumentation“**, wann und von wem sie zuletzt erledigt wurde und wann
sie als Nächstes fällig ist (rot erst nach dem Fälligkeitstag); dort gibt es ebenfalls „Erledigt“ und
**„Rückgängig“**. Zurücknehmen lässt sich nur das **letzte** „Erledigt“ eines Kindes. Mitarbeiter brauchen dafür
dieselbe Berechtigung wie zum Erledigen (das Kind in der eigenen Gruppe, ohne Gruppe oder als Aushilfe) und können
es nur **am selben Tag** zurücknehmen (falls aus Versehen getippt); Leitung und Träger jederzeit. Danach gilt wieder
das vorherige „Erledigt“. Bei einem ausgetretenen Kind lässt sich nichts mehr ändern.

### Einstellungen

Unter *Einstellungen → Kinder → Erinnerungen* legen Leitung und Träger für die Einrichtung fest (die
Entwicklungsdokumentation einer Gruppe steht auf der Seite der Gruppe: *Einstellungen → Gruppen → ‹Gruppe› →
Entwicklungsdokumentation*):

- **Geburtstage der Kinder**: wie viele Tage vorher erinnert wird (0 bis 30, voreingestellt 7),
- **Geburtstage der Mitarbeiter**: ebenso (0 bis 30, voreingestellt 7),
- **Abschied**: wie viele Wochen vorher (0 bis 12, voreingestellt 4),
- die **Entwicklungsdokumentation** je Gruppe und für die Kinder ohne Gruppe (voreingestellt jeweils „aus“):
  - **alle X Monate** (1 bis 24): fällig X Monate nach dem letzten „Erledigt“; ohne „Erledigt“ X Monate nach dem
    Eintritt (sonst nach dem geplanten Eintritt), frühestens X Monate nach dem **„Beginn“** (siehe unten),
  - **um den Geburtstag**: fällig am Geburtstag des Kindes; ohne „Erledigt“ am ersten Geburtstag ab dem Eintritt,
    frühestens ab „gilt seit“. Wer innerhalb der Vorlaufzeit vor dem Geburtstag „Erledigt“ antippt, hat die Doku
    für diesen Geburtstag erledigt,
  - dazu **„erinnern Wochen vorher“** (0 bis 12, voreingestellt 2).

  **„Beginn“ und „gilt seit“**: Die App merkt sich je Gruppe (und für die Kinder ohne Gruppe) einen Starttag. Ohne
  „Erledigt“ zählt die App erst ab diesem Tag.
  - Bei **„alle X Monate“** steht er als Datumsfeld **„Beginn“** neben der Auswahl. Beim Umstellen auf „alle X Monate“ ist
    heute eingetragen; ihr könnt aber jedes Datum der Jahre 2000 bis 2100 wählen, auch in der Vergangenheit oder Zukunft – zum Beispiel den
    01.09.2026 als Start des Kitajahres. Nach „Speichern“ gilt der neue Beginn sofort für alle Kinder der Gruppe, die
    noch kein „Erledigt“ haben. Beispiel: Beginn 01.09.2026 und „alle 12 Monate“ → fällig am 01.09.2027. Liegt der
    Beginn so weit zurück, dass X Monate schon vorbei sind, ist die Erinnerung **sofort rot (überfällig)** – das ist
    so gewollt. Ein Beginn in der Zukunft zeigt bis dahin keine Erinnerung.
  - Bei **„um den Geburtstag“** setzt die App den Tag selbst (der Tag, an dem die Erinnerung eingeschaltet oder die
    Art gewechselt wurde); er steht als „gilt seit ‹Datum›“ unter der Auswahl.

  So gibt es beim Einschalten **keine Flut alter Erinnerungen** für Kinder, die schon lange da sind: Bei „alle 12
  Monate“ mit Beginn heute ist die Doku für sie erst 12 Monate später fällig, bei „um den Geburtstag“ am nächsten
  Geburtstag. Ein Kind, das nach dem Beginn eintritt, zählt ab seinem Eintritt. Ändert ihr nur die Monate oder die
  Wochen vorher, bleibt der Tag gleich; beim Ausschalten wird er gelöscht, beim nächsten Einschalten neu gesetzt
  (heute). Bei Gruppen, die vor dem Update mit „gilt seit“ schon eingeschaltet waren, gilt der Tag jenes Updates.
  Ein „Erledigt“ geht immer vor: Danach zählt die App ab dem letzten „Erledigt“, der Beginn spielt keine Rolle mehr.

  Ein verpasster Termin bleibt in beiden Fällen **rot als überfällig stehen, bis jemand „Erledigt“ tippt** – auch
  wenn der Geburtstag schon lange vorbei ist.

  Es gilt die Einstellung der Gruppe, in der das Kind **heute** ist. Wechselt ein Kind die Gruppe oder ändert sich
  die Einstellung, gilt das sofort.

Den **Geburtstag eines Mitarbeiters** (Tag und Monat, ohne Jahr) tragen Leitung und Träger freiwillig in den
Stammdaten unter *Mitarbeiter* ein. Wer am 29. Februar Geburtstag hat, wird in Nicht-Schaltjahren am 28. Februar
erinnert (bei Kindern ebenso).

## 17. Automatische Ereignisse im Dienstplan und Jahreskalender

Der Dienstplan (Spalte „Info 2“, unter dem eigenen Text; in „Mein Dienstplan“ auf dem Handy unter dem Datum, weil
die Info-Spalten dort rechts außerhalb des Bildschirms liegen) und der Jahreskalender (Zeile „Termine“, nach den eigenen
Terminen) zeigen von selbst, was an einem Tag in der Einrichtung los ist:

| Ereignis | Text | Wann |
|---|---|---|
| Eingewöhnung | „Eingewöhnung (Bären)“ | am Eintrittstag eines Kindes (nicht der geplante Eintritt, keine Vormerkungen) |
| Elterngespräch | „Elterngespräch 14:00 (Bären)“ | am Tag eines Gesprächs, geplant oder schon geführt |
| Kindergeburtstag | „Kindergeburtstag (Bären)“ | am Geburtstag eines Kindes, das an dem Tag da ist |
| Geburtstag Mitarbeiter | „Geburtstag Anna“ | am Geburtstag (Tag und Monat) eines Mitarbeiters, der noch nicht ausgeschieden ist |

- **Keine Kindernamen**: bei Kindern stehen nur das Ereignis und die Gruppe, in der das Kind **an dem Tag** ist (ohne
  Gruppe ohne Klammer). Notizen der Elterngespräche erscheinen nie.
- **Zusammengefasst**: mehrere gleiche Ereignisse am Tag und in derselben Gruppe stehen in einer Zeile,
  z. B. „2× Kindergeburtstag (Bären)“; Elterngespräche je Uhrzeit („2× Elterngespräch 14:00 (Bären)“).
- **Reihenfolge**: zuerst eure eigenen Info-Texte bzw. Termine, dann Eingewöhnung, Elterngespräche (nach Uhrzeit),
  Kindergeburtstage, Geburtstage der Mitarbeiter (nach Name).
- **Überall sichtbar**, wo Dienstplan und Jahreskalender zu sehen sind: bei Leitung und Träger, am Tablet und bei
  den Mitarbeitern auf dem Handy („Mein Dienstplan“, „Mein Kalender“) – auch die **Geburtstage der Kollegen mit
  Namen** (so mit dem Träger entschieden am 20.10.2026). Im Kasten „Erinnerungen“ (Abschnitt 16) bleibt es wie bisher.
- **Ausdruck**: Der gedruckte Dienstplan und der gedruckte Jahreskalender zeigen die Ereignisse ebenso. Die
  Terminliste am Ende des Jahreskalenders enthält nur die eingetragenen Termine.
- **Nicht bearbeitbar**: Die Ereignisse stehen klein, grau und schräg mit einem kleinen Stern-Symbol da und lassen
  sich nicht anklicken oder ändern. Sie kommen aus den Kinderakten (Eintritt, Geburtstag, Gruppe, Elterngespräche) und
  den Mitarbeiter-Stammdaten (Geburtstag) – wer dort etwas ändert, sieht es sofort im Plan.
- **Nicht Teil der Freigabe**: Die Ereignisse werden jedes Mal neu berechnet, auch für einen schon freigegebenen
  Monat. Sie zählen nicht als Änderung, lösen keine Benachrichtigung aus und machen kein erneutes Freigeben nötig.

## 18. Zeiterfassung: zu spät und früher gegangen

In der **Zeiterfassung** (und auf dem gedruckten Stundenzettel) markiert die App, wer später gekommen oder früher
gegangen ist, als es im Dienstplan steht:

- **Zu spät (rot)**: Das erste Einstempeln des Tages liegt mehr als die Kulanz nach dem Beginn des ersten geplanten
  Dienstes. Die Ankunftszeit steht dann rot da, darunter klein z. B. „10 Min. zu spät“.
- **Früher gegangen (blau)**: Das letzte Ausstempeln liegt mehr als die Kulanz vor dem Ende des letzten geplanten
  Dienstes, z. B. „30 Min. früher gegangen“.
- **Geteilte Dienste, mehrere Zeiträume**: verglichen werden nur das erste Kommen mit dem ersten Dienstbeginn und das
  letzte Gehen mit dem letzten Dienstende. Als Dienst zählen Schichten, Sonderdienste und Zeiten wie VZ oder Büro,
  auch Aushilfen in einer anderen Einrichtung – wie bei den übrigen Hinweisen der Zeiterfassung.
- **Keine Markierung** an Tagen ohne geplanten Dienst, bei Urlaub, Krank, Fortbildung, Schule, Feiertag oder
  Schließtag, solange jemand noch eingestempelt ist, und für „früher gegangen“ an Tagen mit „Im Dienst erkrankt“.
- **Heute**: „zu spät“ erscheint gleich nach dem Einstempeln, „früher gegangen“ erst nach dem geplanten Dienstende
  (vorher könnte die Person nur in der Pause sein).
- **Frühere Schließung**: Hat die Einrichtung an dem Tag früher geschlossen, endet der Dienst für „früher gegangen“
  spätestens mit der Schließzeit (bei einer Aushilfe zählt die Schließung der Einrichtung, in der der letzte Dienst
  des Tages liegt). Wer zur Schließzeit geht (abzüglich Kulanz), wird nicht markiert.
- **Korrekturen zählen**: Ändert die Leitung eine Stempelzeit, gilt sofort die geänderte Zeit.
- **Monatssumme** unter der Tabelle: „2× zu spät, zusammen 25 Min.“ und „1× früher gegangen, zusammen 30 Min.“.

**Einstellungen → Zeiterfassung → Zeiterfassung** (Leitung und Träger, je Einrichtung):

- **Kulanz bei zu spät / früher gehen (Minuten)**: ganze Minuten von 0 bis 60, voreingestellt 5. Markiert wird erst,
  was **mehr** als die Kulanz ist (bei 5 Minuten also ab 6 Minuten).
- **Früher gehen markieren**: an (voreingestellt) oder aus. Aus = nur „zu spät“ wird markiert.

Die Einstellungen gelten sofort für alle angezeigten Monate, auch für frühere. **Nur Leitung und Träger** sehen die
Markierungen. Mitarbeiter sehen sie in der App nirgends, auch nicht unter „Meine Zeit“ – nur auf einem Stundenzettel,
den die Leitung ausdruckt und ihnen gibt, stehen sie mit drauf.

### Stempeln ohne Netz am Tablet

Fällt das Internet oder der Server aus, kann am **Kita-Tablet** (Konto „Tablet“) trotzdem gestempelt werden:

- **Voraussetzung:** Die Seite *Stempeln* wurde auf dem Tablet **einmal mit Netz** geöffnet (nach jedem Update der App
  einmal neu). Dann merkt sich das Tablet die Seite und die Namensliste. Ohne Netz öffnet sich die Seite trotzdem,
  auch nach einem Neustart des Browsers. Andere Seiten der App gehen ohne Netz nicht; die Kinder und das Stempeln mit
  dem eigenen Handy gibt es nur mit Netz.
- **Gelber Balken:** „Offline – Stempel werden gespeichert und später übertragen“, solange der Server nicht erreichbar
  ist, und „3 Stempel noch nicht übertragen“, solange noch Stempel auf dem Tablet warten.
- **So wird gestempelt:** Name antippen, PIN eingeben, **Einstempeln** oder **Ausstempeln** (ohne Netz weiß das Tablet
  nicht, wer eingestempelt ist, darum stehen beide Knöpfe da). Das Tablet zeigt „Gespeichert (offline) – Anna Kommt
  07:58“. Gespeichert wird die **Uhrzeit des Tablets**. Die PIN wird dabei noch nicht geprüft.
- **Was das Tablet speichert:** nur Namen und Nummern der Mitarbeiter für die Liste und die wartenden Stempel. Die PIN
  liegt **verschlüsselt** auf dem Tablet und wird gelöscht, sobald der Server den Stempel beantwortet hat. Das schützt
  davor, dass jemand die PINs einfach ablesen kann; wer das entsperrte Tablet selbst bedient oder untersucht, kommt
  aber grundsätzlich an die wartenden Stempel heran – das Tablet also wie bisher nicht unbeaufsichtigt entsperrt
  liegen lassen. Kinderdaten speichert das Tablet nicht. Meldet sich das Tablet-Konto ab, vergisst das Tablet die
  Namensliste.
- **Übertragen:** Sobald der Server wieder erreichbar ist, schickt das Tablet die Stempel von selbst in der Reihenfolge,
  in der gestempelt wurde (beim Öffnen der Seite, wenn das Netz zurück ist, und sonst etwa jede Minute einen neuen
  Versuch). Ein Stempel, der doppelt ankommt, wird nur einmal gezählt. Antwortet der Server zwar, lehnt das Übertragen
  aber ab (z. B. ein Fehler auf dem Server), steht rot „2 Stempel konnten nicht übertragen werden – bitte Leitung
  informieren“; das Tablet versucht es weiter, neue Stempel gehen dann normal mit Netz.
- **Was der Server prüft (in dieser Reihenfolge):** dass der Stempel höchstens 5 Minuten in der Zukunft und höchstens
  7 Tage zurück liegt, dass die Person zur Einrichtung gehört (oder an dem Tag hier als Aushilfe eingeplant ist), an
  dem Tag beschäftigt ist und Zeiterfassung hat, dann die PIN **wie beim Stempeln mit Netz** – und zuletzt, dass der
  Stempel zu den Zeiten des Tages passt (ein „Kommt“ nur, wenn die Person nicht schon eingestempelt ist und nichts
  Späteres erfasst ist; ein „Geht“ nur zu einem offenen „Kommt“). Passt alles, steht der Stempel in der Zeiterfassung
  mit dem Zeichen **„offline erfasst“** (das sieht auch die Person selbst unter „Meine Zeit“ bzw. im eigenen
  Dienstplan). Eine Zeit, die ein paar Minuten nach der Uhr des Servers liegt, wird als „jetzt“ eingetragen.
- **Uhr des Tablets:** Weicht die Uhr des Tablets beim Übertragen um mehr als 5 Minuten von der Uhr des Servers ab,
  steht bei diesen Stempeln zusätzlich **„Uhrzeit des Tablets wich ab (12 Min.)“** – nur für Leitung und Träger. Die
  Zeit wird nicht von selbst verschoben; bitte prüfen und bei Bedarf korrigieren und die Uhr des Tablets stellen. Geht
  die Uhr des Tablets vor, werden die letzten Stempel deswegen nicht als „in der Zukunft“ abgelehnt (bis 60 Minuten).
- **Was nicht übernommen wird – „Offline-Stempel – bitte prüfen“:** Stempel mit falscher PIN („Offline-Stempel mit
  falscher PIN – bitte prüfen: Anna, 19.11.2026 07:58“), bei gesperrter PIN, ohne hinterlegte PIN, mit Uhrzeit in der
  Zukunft, älter als 7 Tage oder die nicht zu den erfassten Zeiten passen („Offline-Stempel „Geht“ ohne „Kommt“ …“)
  werden **nicht** als Zeit eingetragen. Sie stehen für Leitung und Träger in der **Zeiterfassung** oben in der Liste
  „Offline-Stempel – bitte prüfen“ und in den **Erinnerungen**. Ein Tipp auf den Eintrag öffnet Person und Tag; die
  Zeit dann bei Bedarf selbst eintragen und **„Geprüft“** antippen – dann verschwindet der Hinweis. Je Person stehen
  höchstens 20 Hinweise in der Liste.
- **Falsche PINs zählen zur Sperre:** Eine falsche PIN aus der Offline-Liste zählt wie eine falsche Eingabe am Tablet
  (nach 5 falschen Eingaben ist die PIN 15 Minuten gesperrt usw., siehe *Stempel-PIN*); dieselbe falsche PIN einer
  Person zählt pro Übertragung nur einmal. Ist die PIN gesperrt, wird sie bei Offline-Stempeln gar nicht geprüft
  („Offline-Stempel bei gesperrter PIN“). „Geprüft“ hebt keine Sperre auf – das geht nur mit „PIN freischalten“. Das
  Tablet erfährt beim Übertragen nur „erledigt“ oder „abgelehnt“, nicht den Grund. Das erschwert das Ausprobieren von
  PINs über das Tablet.
- **Doppelt gestempelt:** Ging ein Stempel mit Netz durch, aber die Antwort kam nicht mehr an, speichert das Tablet ihn
  offline noch einmal. Liegt beim Übertragen schon ein Kommen bzw. Gehen derselben Person zur selben Minute (±1 Minute)
  vor, wird er ohne Hinweis als erledigt gezählt; sonst kann er als „passt nicht zu den erfassten Zeiten“ in der Liste
  landen.
- **Nicht übernommen und ohne Hinweis** werden Stempel für Personen, die das Tablet an dem Tag nicht kennt (z. B. eine
  Aushilfe an einem Tag ohne Einsatz hier), die an dem Tag nicht mehr beschäftigt sind, oder an Tagen ohne
  Zeiterfassung.
- **Wenn sich ein anderes Konto am Tablet anmeldet** (z. B. die Leitung), vergisst das Tablet die gemerkte Seite; die
  wartenden Stempel bleiben und werden übertragen, sobald das Tablet-Konto wieder angemeldet ist.
- **Ohne Speicher:** Kann der Browser des Tablets nichts speichern (z. B. privates Fenster), steht ohne Netz „Offline –
  Stempeln ist auf diesem Gerät gerade nicht möglich“.
- **Technisch:** Das Tablet braucht dafür eine sichere Verbindung (https) und einen aktuellen Browser. Die gemerkte
  Seite gehört zur jeweiligen App-Version; nach einem Update wird die alte gelöscht und die neue beim nächsten Öffnen
  mit Netz gemerkt. Das Übertragen ist begrenzt (höchstens 50 Stempel und 10 PIN-Prüfungen je Übertragung, höchstens
  10 Übertragungen pro Minute); der Rest folgt von selbst mit der nächsten.
- **Hinweis zum Update (Datenbank):** Die Änderung bringt die Datenbank-Änderung 0090 (Offline-Stempel) mit. Eine
  Datenbank, die schon mit einem Entwicklungsstand mit der Änderung 0091, aber ohne 0090 gelaufen ist, würde 0090
  überspringen; der Betrieb (vor diesem Update auf Stand 0082) ist davon nicht betroffen. Nach dem Update sollte die
  Zeiterfassung wie gewohnt öffnen – wenn nicht, bitte melden.

## 19. Dokumente: Vorlagen (leere Formulare zum Ausdrucken) und Bögen

Im Menü gibt es **Dokumente** (Leitung und Träger unter **Mehr**, Mitarbeiter unter **Meins**). Die Seite hat drei
Reiter: **Bögen** (die Vorlagen für Mitarbeitergespräche, Beobachtungsbögen, Teamsitzungen und Unfallberichte, siehe
Abschnitt 25; nur wer Bögen pflegen darf), **Vorlagen** und **Wissen** (siehe Abschnitt 28). Jeder sieht nur die Reiter,
die er nutzen darf – Mitarbeiter und das Tablet **Vorlagen** und **Wissen**. Alte Lesezeichen auf „Vorlagen“ oder „Bögen“ führen automatisch zum passenden Reiter.

Unter **Vorlagen** liegen leere PDF-Formulare, die man immer wieder ausdruckt – z. B. Elternbriefe,
Einverständniserklärungen, ein Formular für Medikamente oder einen Urlaubsantrag.

- **Kategorien**: Jede Kategorie ist ein eigener Unterreiter, in der Reihenfolge der Kategorien. Das Gerät merkt sich den
  zuletzt geöffneten Unterreiter. Die Kategorien gehören **jeder Einrichtung selbst**: Leitung und Träger pflegen die
  Kategorien der oben gewählten Einrichtung mit **Kategorien verwalten**: anlegen, umbenennen, mit den Pfeilen
  **nach oben / nach unten** schieben, **„Wer sieht sie?“** ändern und löschen. Löschen geht nur bei einer **leeren**
  Kategorie – liegen noch Vorlagen der Einrichtung darin, verschieb oder lösch sie zuerst. Jeder Name kommt in einer
  Einrichtung nur einmal vor (Groß- und Kleinschreibung zählt nicht); andere Einrichtungen sind davon nicht betroffen.
- **Unterkategorien** (eine Ebene): In **Kategorien verwalten** legt **Unterkategorie anlegen** (Ordner-Knopf bei einer
  Kategorie) eine Unterkategorie an. Sie steht eingerückt unter ihrer Kategorie und lässt sich umbenennen, mit den Pfeilen
  innerhalb ihrer Kategorie verschieben und löschen, solange keine Vorlagen der Einrichtung darin liegen. In eine andere
  Kategorie verschieben lässt sie sich nicht, und eine Unterkategorie hat keine eigenen Unterkategorien. Eine Kategorie
  mit Unterkategorien lässt sich erst löschen, wenn ihre Unterkategorien gelöscht sind. Unter einer Kategorie kommt jeder
  Name nur einmal vor; derselbe Name darf in einer anderen Kategorie stehen. **„Wer sieht sie?“** einer Unterkategorie
  gilt zusätzlich zu dem ihrer Kategorie – die engere Einstellung zählt (eine Unterkategorie für **Alle** in einer
  Kategorie „Nur Leitung und Träger“ sehen also auch nur Leitung und Träger). Neue Einrichtungen beginnen ohne
  Unterkategorien; beim Update auf die Version mit Unterkategorien blieben alle Kategorien und Vorlagen, wie sie waren.
- **Zweite Reihe**: Hat eine Kategorie Unterkategorien, steht auf ihrem Unterreiter eine zweite Reihe kleiner Reiter:
  **Alle** (alle Vorlagen der Kategorie, nach Unterkategorien gruppiert, zuerst die direkt in der Kategorie), **Allgemein**
  (die Vorlagen direkt in der Kategorie – nur, wenn es welche gibt) und die Unterkategorien in ihrer Reihenfolge. Die
  kleinen Reiter brechen auf dem Handy in die nächste Zeile um. Das Gerät merkt sich je Kategorie die letzte Wahl.
- **Hochladen und Bearbeiten** mit Unterkategorien: Nach der Kategorie gibt es die Auswahl **Unterkategorie** (nur wenn
  die gewählte Kategorie welche hat; „Allgemein (keine Unterkategorie)“ legt die Vorlage direkt in die Kategorie). Beim
  Hochladen ist die Unterkategorie des geöffneten kleinen Reiters vorausgewählt.
- **Neue Einrichtungen** beginnen mit den Kategorien „Eingewöhnungsmappe“, „Mitarbeitermappe“, „Eltern“, „Gesundheit“
  und „Personal“ (für **Alle**), als eigene Kopien zum Ändern oder Löschen.
- **Wer sieht sie?** Jede Kategorie hat eine von drei Stufen:
  - **Alle (auch Mitarbeiter und Tablet)**: Leitung, Träger, das Tablet und die Mitarbeiter mit ihrem eigenen Konto.
  - **Nur Leitung und Träger**: z. B. für Formulare der Verwaltung.
  - **Nur Träger**: diese Kategorien sieht nur der Träger; nur er kann sie anlegen, ändern oder löschen. Die Leitung
    sieht sie gar nicht und kann auch keine Kategorie auf „Nur Träger“ stellen. Stellt der Träger eine Kategorie mit
    Vorlagen auf „Nur Träger“, fragt die App vorher nach und nennt, wie viele Vorlagen Leitung, Mitarbeiter und Tablet
    dann nicht mehr sehen.

  Die Vorlagen in einer Kategorie sieht nur, wer die Kategorie sieht; Unterreiter für Kategorien, die man nicht sieht,
  erscheinen gar nicht. Kategorien, die nicht alle sehen, sind markiert („nur Leitung und Träger“ bzw. „nur Träger“).
- **Hochladen**: Leitung und Träger öffnen **Dokumente** → **Vorlagen** und tippen auf **Vorlage hochladen**. Erlaubt
  sind nur **PDF-Dateien bis 30 MB** (wie bei den Dokumenten der Kinder; die App prüft, ob es wirklich ein PDF ist). Der
  **Titel** wird aus dem Dateinamen vorgeschlagen und lässt sich ändern. Die **Kategorie** ist die des geöffneten
  Unterreiters und lässt sich in der Liste ändern; gibt es noch keine, leg zuerst unter **Kategorien verwalten** eine an.
- **Gilt für** (beim Hochladen und später mit **Bearbeiten**):
  - **Einrichtungen**: Die **Leitung** lädt Vorlagen für die **eigene Einrichtung** hoch. Der **Träger** wählt „nur
    ‹Einrichtung›“ (die oben gewählte), **„alle Einrichtungen (auch neue)“** oder **„ausgewählte Einrichtungen“**
    (Häkchen). Vorlagen des Trägers sind mit **„alle Einrichtungen“** markiert. Bei ausgewählten Einrichtungen steht für
    Leitung und Träger dazu „nur Kita A, Kita B“.
  - **Gruppen**: je Einrichtung **„alle Gruppen“** oder **„nur bestimmte Gruppen“** (Häkchen). Die Leitung darf das für
    Vorlagen ihrer Einrichtung einstellen. Mitarbeitende sehen eine solche Vorlage nur, wenn ihre **Stammgruppe**
    (die Gruppe im Dienstplan) gewählt ist. Leitung und Träger sehen sie immer, mit dem Hinweis „nur Bären, Füchse“. Das
    **Tablet** zeigt sie nur, solange es von jemandem aus diesen Gruppen entsperrt ist (gesperrt: nur Vorlagen für alle
    Gruppen). Aushilfen aus anderen Einrichtungen und Personen ohne Stammgruppe sehen nur Vorlagen für alle Gruppen.
  - Wird eine gewählte Gruppe gelöscht, fällt sie aus der Auswahl. Ist danach keine Gruppe mehr gewählt, sehen nur
    noch Leitung und Träger die Vorlage („keine Gruppe mehr gewählt“).
  - **Ändern**: Der Träger kann eine Vorlage nachträglich anderen Einrichtungen zuordnen. Für mehrere Einrichtungen wird
    sie nach dem Namen ihrer Kategorie einsortiert (vorbelegt mit der bisherigen); „nur ‹Einrichtung›“ macht sie wieder
    zur Vorlage der oben gewählten Einrichtung (Kategorie auswählen). Ist sie danach in Einrichtungen nicht mehr zu
    sehen, fragt die App vorher nach. Wo sie neu dazukommt, steht sie am Ende; Einrichtungen, die sie verlieren, vergessen
    ihren Platz.
  - **Wer sieht sie?** lässt sich jetzt bei jeder Vorlage einstellen, auch bei den eigenen der Einrichtung; es gilt
    zusätzlich das der Kategorie (die engere Einstellung zählt).
  - **Beim Update** auf diese Version blieb alles, wie es war: eigene Vorlagen gelten für ihre Einrichtung, die des
    Trägers für alle Einrichtungen, jeweils für alle Gruppen.
- **Suchen**: Über den Unterreitern sucht ein Suchfeld in Titel, Kategorie und Unterkategorie aller Vorlagen, die du
  sehen darfst (Groß-/Kleinschreibung egal, „ä“ findet auch „ae“, „ß“ auch „ss“). Solange etwas eingetippt ist, stehen
  statt der Unterreiter die Treffer da, nach „Kategorie › Unterkategorie“ gruppiert, mit **Öffnen**, **Ausfüllen** und
  **Bearbeiten**. Leert man das Feld, ist wieder der vorherige Unterreiter offen. Ebenso gibt es im Reiter **Bögen** ein
  Suchfeld über die Namen aller Vorlagen (nach Art gruppiert, auch die archivierten).
- **Vorlagen für alle Einrichtungen** (nur der Träger): Statt einer Kategorie gibt der Träger den **Namen** einer
  Kategorie an – aus der Liste der Namen, die die Einrichtungen verwenden, oder frei getippt – und wählt, **wer sie
  sieht**. Jede Einrichtung zeigt die Vorlage in ihrer Kategorie mit diesem Namen (Groß- und Kleinschreibung zählt
  nicht). Hat eine Einrichtung keine solche Kategorie (oder löscht sie sie), steht die Vorlage dort im Unterreiter
  **„Vom Träger“**; den gibt es nur, wenn es solche Vorlagen gibt. Sieht die Kategorie der Einrichtung weniger Leute als
  die Vorlage, gilt die Kategorie (die engere Einstellung gewinnt). Freiwillig gibt der Träger auch den Namen einer
  **Unterkategorie** an: Hat die Kategorie der Einrichtung eine Unterkategorie mit diesem Namen, steht die Vorlage dort
  (es gilt dann die engste Einstellung von Vorlage, Kategorie und Unterkategorie), sonst direkt in der Kategorie unter
  „Allgemein“, sonst unter „Vom Träger“ (dort mit „Kategorie › Unterkategorie“ beschriftet).
- **Ändern**: Mit **Bearbeiten** lassen sich Titel und Kategorie ändern und die Datei durch eine neue ersetzen;
  **Löschen** fragt vorher nach. Die Vorlagen für alle Einrichtungen kann **nur der Träger** ändern oder löschen.
- **Reihenfolge**: Wer Vorlagen bearbeiten darf, schiebt jede Vorlage mit den Pfeilen **Nach oben / Nach unten** (rechts
  in der Zeile) innerhalb ihres Unterreiters. Die Reihenfolge gilt für die **oben gewählte Einrichtung** und für alle,
  die dort die Vorlagen ansehen (Mitarbeiter und Tablet sehen dieselbe Reihenfolge, aber keine Pfeile). Auch die
  Vorlagen für alle Einrichtungen lassen sich so schieben – das ändert nur die Reihenfolge in dieser Einrichtung; jede
  Einrichtung hat ihre eigene. Eine **neu hochgeladene** Vorlage kommt ans **Ende** ihrer Kategorie (eine für alle
  Einrichtungen in jeder Einrichtung); ebenso eine, die in eine **andere Kategorie** verschoben wird. Nur den Titel oder
  die Datei zu ändern lässt den Platz, wie er ist. Vorlagen, die jemand nicht sieht (z. B. eine Vorlage des Trägers „Nur
  Träger“), behalten beim Schieben ihren Platz. Mit Unterkategorien hat jede Unterkategorie ihre eigene Reihenfolge,
  ebenso „Allgemein“ (die Vorlagen direkt in der Kategorie). Unter **Alle** schieben die Pfeile innerhalb der jeweiligen
  Gruppe – das ist dieselbe Reihenfolge wie im kleinen Reiter der Unterkategorie. Eine Vorlage, die in eine andere
  Unterkategorie (oder aus einer heraus) kommt, steht dort am Ende.
- **Beim Update** auf die Version mit der Reihenfolge stehen die Vorlagen wie bisher alphabetisch, bis jemand sie
  verschiebt oder eine neue hochlädt; von da an zählt in diesem Unterreiter die gespeicherte Reihenfolge.
- **Drucken**: **Öffnen** zeigt das PDF in einem neuen Tab; dort druckst du es mit der Druckfunktion des Browsers.
- **Am Tablet**: Auf der Startseite des Tablets gibt es den Knopf **Vorlagen**; er öffnet **Dokumente** → **Vorlagen**.
  Dort lassen sich die Vorlagen der Kategorien für **Alle** öffnen und drucken – **ohne PIN**, weil darin keine Daten
  von Kindern stehen. Hochladen und ändern geht am Tablet nicht.
- **Mitarbeiter** finden die Vorlagen mit ihrem eigenen Konto (Handy, privater PC) unter **Meins** → **Dokumente**: nur
  die Kategorien für **Alle**, nur zum Öffnen und Drucken – hochladen, ändern und die Kategorien verwalten können sie
  nicht.
- **Beim Update** auf die Version mit den Kategorien je Einrichtung bekommt jede Einrichtung eine eigene Kopie jeder
  bisherigen Kategorie (gleicher Name, gleiche Reihenfolge, gleiches „Wer sieht sie?“), und ihre Vorlagen liegen danach
  in ihrer Kopie. Dazu kommen vorne „Eingewöhnungsmappe“ und „Mitarbeitermappe“ (für **Alle**), wenn es eine Kategorie
  mit diesem Namen noch nicht gibt. Die Vorlagen für alle Einrichtungen behalten den Namen und das „Wer sieht sie?“ ihrer
  bisherigen Kategorie.
- **Beim Update** auf die erste Version mit Kategorien machte die App aus jeder bisher eingetippten Kategorie eine
  Kategorie (für **Alle**, nach Namen sortiert, Umlaute wie ihr Grundbuchstabe) und ordnete jede Vorlage ihr zu;
  „eltern“ und „Eltern“ (ebenso „übungen“ und „Übungen“, „Straße“ und „STRASSE“) wurden dabei eine Kategorie, Vorlagen
  ohne Kategorie kamen unter „Sonstiges“. Gab es noch keine Vorlagen, begann die App mit „Eltern“, „Gesundheit“ und
  „Personal“.

### Formulare in der App ausfüllen

Jede PDF-Vorlage lässt sich in der App ausfüllen: neben **Öffnen** steht der Knopf **Ausfüllen**. Hat die Vorlage
**Formularfelder** (Textfelder, Kästchen zum Ankreuzen, Auswahllisten – z. B. eine Einverständniserklärung oder die
Unfallanzeige der Unfallkasse), füllst du diese aus. Auf jede Vorlage, auch ein eingescanntes Blatt ohne Felder, kannst
du außerdem überall **Text**, ein **Häkchen**, ein **Kreuz** und eine **Unterschrift** setzen.

- **Für wen**: Nach **Ausfüllen** wählst du **für ein Kind** oder **für eine Person aus dem Team** und suchst das Kind
  bzw. die Person in der Liste (Name eintippen). Angeboten wird nur, wohin du auch Dokumente hochladen darfst: Kinder,
  deren Akte du ändern darfst (wie beim Hochladen eines Dokuments), und Personen, deren Personalakte du siehst und in
  deren Fächer du Dokumente ablegen darfst. Wer beides nicht darf, sieht den Knopf **Ausfüllen** nicht.
- **Ansicht**: Die Vorlage erscheint groß auf dem Bildschirm, die Seiten untereinander. Oben wechselst du die
  **Seite** (Pfeile) und machst die Ansicht **größer oder kleiner** (Lupen; die Prozentzahl stellt wieder auf die
  volle Breite). Am Handy und am Tablet geht das auch mit zwei Fingern (auseinanderziehen bzw. zusammenschieben).
- **Werkzeuge** (Leiste über der Seite; der grüne Knopf ist das gewählte Werkzeug, darunter steht ein kurzer Hinweis):
  - **Felder** (nur bei Vorlagen mit Formularfeldern): Felder antippen und ausfüllen.
  - **Text**: Auf die Stelle tippen, an die der Text soll, und schreiben. Die **Schriftgröße** (klein, normal, groß)
    gilt für neue Texte und für den gerade ausgewählten Text.
  - **Häkchen** und **Kreuz**: Auf die Stelle tippen – das Zeichen erscheint dort. So kannst du mehrere setzen.
  - **Unterschrift**: Es öffnet sich ein weißes Feld. Darin mit dem Finger, einem Stift oder der Maus unterschreiben
    (**Neu anfangen** wischt es leer) und **Einfügen** tippen. Die Unterschrift erscheint in der Mitte der Seite; schieb
    sie an ihren Platz, an den Ecken änderst du die Größe.
  - **Auswählen**: Etwas Eingefügtes antippen wählt es aus (bei einem Text wechselt die App dabei zum Werkzeug
    **Text**). Danach verschiebst du es durch Ziehen, an den Ecken änderst du die Größe, oder du löschst es. Einen Text
    änderst du, indem du ihn zweimal antippst.
  - **Löschen** entfernt, was gerade ausgewählt ist (ebenso der kleine Papierkorb daneben), **Rückgängig** nimmt den
    letzten Schritt beim Einfügen, Verschieben oder Löschen zurück.
- **Drucken** druckt die Seiten mit allen Eingaben, **ohne** etwas zu speichern.
- **Speichern** legt die ausgefüllte Vorlage als neues Dokument ab:
  - **bei einem Kind** in der Kinderakte unter **Dokumente**. Du wählst die **Art** (vorgeschlagen: die Art mit dem
    Namen der Vorlage, sonst „Sonstiges“), das **Datum** (heute) und die **Bezeichnung** (vorgeschlagen: Titel der
    Vorlage und Datum, z. B. „Einverständnis Ausflug 20.11.2026“). **Vertraulich** ist es, wenn die Art das so vorsieht;
    das lässt sich ändern.
  - **bei einer Person** in der Personalakte (Reiter **Nachweise** → **Dokumente**) in einem **Fach**, das du nutzen
    darfst, mit Datum und Bezeichnung wie oben.
  Text, Häkchen, Kreuz und Unterschrift werden als normale PDF-Anmerkungen gespeichert, die jedes PDF-Programm anzeigt
  und druckt. Wäre die Datei größer als **30 MB**, sagt die App das und speichert nicht.
- **Schließen** mit noch nicht gespeicherten Eingaben fragt vorher nach; ebenso, wenn du die Seite verlässt.
- **Die Vorlage selbst ändert sich nie.** Die Eingaben bleiben nur auf dem Gerät, bis du speicherst.
- **Bearbeiten**: Jedes gespeicherte PDF in der Kinderakte bzw. Personalakte hat den Knopf **Bearbeiten**. Es öffnet
  sich mit den bisherigen Eingaben; was mit der App eingefügt wurde (Text, Häkchen, Kreuz, Unterschrift), lässt sich
  mit **Auswählen** bzw. **Text** wieder verschieben, ändern oder löschen. **Speichern** ersetzt dann die Datei dieses
  Dokuments. Art, Bezeichnung, das Datum des Dokuments (und das Fach) bleiben, „hochgeladen von … am …“ zeigt danach,
  wer zuletzt gespeichert hat und wann. Das Speichern zählt wie ein neues Hochladen: Muss nach einem Gruppenwechsel
  oder für einen Vertrag ein Dokument dieser Art neu eingereicht werden, gilt es damit als eingereicht. Das darf, wer
  das Dokument auch ändern darf.
- **Aus Vorlage ausfüllen**: In der Kinderakte (Dokumente) und in der Personalakte (Nachweise → Dokumente) gibt es
  außerdem den Knopf **Aus Vorlage ausfüllen**. Er zeigt die Vorlagen der Einrichtung, die du sehen darfst; Kind bzw.
  Person sind schon gewählt.
- **Am Tablet** geht das nur bei Kindern und nur, wenn das Tablet mit einer PIN entsperrt ist, deren Person Dokumente in
  Kinderakten hochladen darf (in der Kinderakte: **Aus Vorlage ausfüllen** und **Bearbeiten**). Personalakten gibt es
  am Tablet nicht. Unter **Vorlagen** auf der Startseite (ohne PIN) gibt es deshalb kein **Ausfüllen**.
- Es gelten dieselben Regeln wie beim Hochladen: nur PDF, höchstens **30 MB**, nur in der eigenen Einrichtung.
- **Unterschrift**: Eine so gezeichnete Unterschrift ist eine **einfache elektronische Signatur** – keine
  qualifizierte elektronische Signatur. Wo das Gesetz die Schriftform verlangt (z. B. Kündigung eines
  Arbeitsverhältnisses, Befristung eines Arbeitsvertrags, Arbeitszeugnis), reicht sie nicht; dann bitte auf Papier
  unterschreiben.
  Die Unterschrift steckt nur in dem gespeicherten PDF in der Akte. Die App speichert sie nirgends sonst (auch nicht auf
  dem Gerät) und bietet sie nicht zum Wiederverwenden an; das Unterschriftenfeld wird nach dem Einfügen geleert.
- Felder mit Rechenformeln oder Prüfungen (Skripte im PDF) rechnet die App nicht aus; solche Felder füllst du von Hand.
  Ist ein PDF verschlüsselt oder sehr ungewöhnlich aufgebaut, erkennt die App die Felder unter Umständen nicht; Text,
  Häkchen, Kreuz und Unterschrift gehen trotzdem. Ob eine Datei Felder hat, prüft die App einmal beim Hochladen bzw.
  Ersetzen.
- Bilder lassen sich nicht ins PDF einfügen (kein Einfügen aus der Zwischenablage, kein Hineinziehen von Dateien);
  eingefügt werden nur Text, Häkchen, Kreuz und die gezeichnete Unterschrift.
- Erscheint oben **„Zusatzwerkzeuge nicht verfügbar – Felder ausfüllen geht weiter“**, konnten Text, Häkchen, Kreuz und
  Unterschrift auf diesem Gerät nicht starten (z. B. ein sehr alter Browser). Felder ausfüllen, Drucken und Speichern
  gehen weiter. Bitte der Person melden, die die App betreut.
- **Für die Betreuung der App**: Die Ansicht nutzt Teile von pdf.js (Paket `pdfjs-dist`), die nicht zur offiziellen
  Schnittstelle gehören. Darum ist die Version fest eingetragen (derzeit **6.3.289**, `package.json` und
  `package-lock.json`), und Renovate legt für pdf.js einen eigenen PR an, der nie automatisch gemergt wird. Vor dem
  Mergen: `npm test` (der Test `pdfjsContract` prüft die genutzten Teile) und die Ansicht von Hand ausprobieren
  (Vorlage ausfüllen mit Feldern, Text, Häkchen, Unterschrift, Speichern, danach **Bearbeiten** und Drucken; dazu
  ein eingescanntes PDF ansehen).

## 20. Personalschlüssel

Die App rechnet je Gruppe und für die ganze Einrichtung aus, wie viel pädagogisches Personal nach den Vorgaben des
Bundeslands nötig ist (**Soll**), und vergleicht das mit dem Dienstplan (**Ist**). Sie ist eine **Planungshilfe – keine
rechtliche Prüfung.** Bitte die Vorgaben mit der Heimaufsicht/dem Landesjugendamt abgleichen. Dieser Hinweis steht
auch im Reiter und in den Einstellungen.

### Was vorher eingetragen sein muss

- **Bundesland** der Einrichtung (Einstellungen → Einrichtung → Einrichtungen, Träger). Danach richten sich alle Zahlen.
- **Qualifikation** bei jedem Mitarbeiter (Mitarbeiter → Name → Stammdaten, Leitung oder Träger): Fachkraft,
  Ergänzungs-/Zusatzkraft, Auszubildende/r (1./2./3. Jahr), Studium praxisintegriert/dual (1./2./ab 3. Studienjahr),
  Berufspraktikant/in (Anerkennungsjahr), Haushaltskraft oder **keine pädagogische Kraft (z. B. Aushilfe,
  Werkstudent/in)**. Küche, Hauswirtschaft und Reinigung bitte als „keine pädagogische Kraft“ eintragen, sonst zählen
  sie mit. Praxissemester, Pflichtpraktikum oder Werkstudent/in ohne pädagogischen Abschluss ebenfalls als „keine
  pädagogische Kraft“. Welche Anrechnung das Land für Auszubildende, Studierende und Berufspraktikanten vorgibt (und
  auf welcher Grundlage), steht im Hinweis der Vorgabe unter Einstellungen → Personalschlüssel. Diese Werte gelten ab
  November 2026 (neue Recherche, keine Gesetzesänderung); für frühere Monate bleiben die bisherigen Werte. Hat der
  Träger einen dieser Werte geändert, gilt seine Änderung weiter.
  „Anrechnung in %“ bleibt meist leer: dann gilt die Vorgabe des Landes für die Qualifikation (sie steht grau im
  Feld). Eine eigene Zahl (0 bis 100) gilt nur für diese Person.
- **Sozialpädagogische Assistenz praxisintegriert (1./2./3. Jahr)** (seit 19.11.2026): eigene Qualifikation für die
  praxisintegrierte Ausbildung („PiA“: Ausbildung mit Vertrag und Bezahlung in der Kita, Schule an einzelnen Tagen)
  zur Sozialpädagogischen Assistenz. In **Baden-Württemberg** zählt sie ab November 2026
  im 1. Jahr 0 %, im 2. und 3. Jahr 20 % (KM-FAQ zum KiTaG,
  https://km.baden-wuerttemberg.de/de/fruehe-bildung/kindertageseinrichtungen/faq-kindertagesbetreuungsgesetz, geprüft
  19.11.2026; dieselbe FAQ bestätigt: PiA Erzieher und DHBW-Studierende bis 40 %, Anerkennungspraktikum bis 100 %). In
  den anderen Ländern 0 % (keine Regel für diese Ausbildung hinterlegt; bei Bedarf „Anrechnung in %“). Bekommen sie
  eine eigene Anrechnung, zählen sie in Berlin (höchstens 33 %) und Mecklenburg-Vorpommern (höchstens 25 %) bei der
  Obergrenze für Auszubildende mit. Wie die anderen
  Auszubildenden bekommt sie den Hinweis „Geburtsjahr fehlt“ (Jugendarbeitsschutz). Wer bisher als Auszubildende/r mit
  eigener Anrechnung 20 % eingetragen war, kann auf die neue Qualifikation umgestellt werden.
- **Baden-Württemberg – Kinderpfleger/innen und Sozialpädagogische Assistent/innen sind Fachkräfte** (§ 7 Abs. 2 Nr. 6
  KiTaG). Bitte als **„Fachkraft“** eintragen, nicht als Ergänzungs-/Zusatzkraft – die zählt in Baden-Württemberg 0 %.
  Das steht bei BW-Einrichtungen auch im Hilfetext der Qualifikation.
- **Solange bei keinem Mitarbeiter der Einrichtung eine Qualifikation eingetragen ist, zeigt der Dienstplan keine
  Personalschlüssel-Warnungen.** Der Reiter sagt dann „Bitte bei den Mitarbeitern die Qualifikation eintragen“.
  Mitarbeiter ohne Qualifikation zählen mit ihrer Anrechnung (ohne Angabe 100 %), aber nicht als Fachkraft; der Reiter nennt ihre Namen.
- **Gruppenart** (Einstellungen → Gruppen → ‹Gruppe› → „Gruppenart (Personalschlüssel)“, Leitung oder Träger) – nur in Ländern, die danach
  rechnen (z. B. Baden-Württemberg: Halbtags-, Regel-, VÖ-, Ganztagsgruppe, Krippe). Ohne Gruppenart zählen die Kinder
  der Gruppe nicht für das Soll; der Reiter weist darauf hin.
- **Betreuungsform** mit Zeitfenster und **Tage pro Woche** (Einstellungen → Kinder → Betreuungsformen, voreingestellt 5) bei
  jedem Kind. Wochenstunden des Kindes = Zeitfenster × Tage. Kinder ohne Betreuungsform zählen nicht für das Soll
  („Kinder ohne Betreuungsform: 2“).
- Für die Warnungen nach Uhrzeit: **Öffnungszeiten** (Abschnitt 13).

### So wird gerechnet

- **Kinder:** die Kinder mit Vertrag im Monat, wie in der Belegung (wer im Monat die Gruppe wechselt, zählt in beiden
  Gruppen mit; in der Kinderzahl der Einrichtung einmal, bei Verfahren je Kind steht sein Bedarf für diesen Monat aber
  in beiden Gruppen im Soll). Das Alter zählt am Monatsersten: unter 3, 3 bis Schule, Schulkind.
- **Soll** je nach Land, zum Beispiel: Vollzeitkräfte je Gruppe nach Gruppenart (Baden-Württemberg Regelgruppe 1,8;
  angepasst an die Öffnungszeit), Kinder je Vollzeitkraft nach Alter und Betreuungszeit (Berlin, Brandenburg, Sachsen
  …), gewichtete Buchungsstunden (Bayern 1 : 11, unter 3 doppelt) oder Stundenpauschalen je Gruppenform
  (Nordrhein-Westfalen). Dazu kommen Zuschläge des Landes (z. B. Ausfallzeiten); die **Leitungszeit** wird nur
  angezeigt, nicht geprüft.
- **Ist:** die im Dienstplan eingeplante Arbeitszeit des Monats an Betreuungstagen (ohne Wochenenden, Feiertage,
  Schließtage) × Anrechnung der Qualifikation, umgerechnet in Vollzeitkräfte (Vollzeit = Wochenstunden laut Land,
  meist 39). Ein Dienst zählt für seine Gruppe, sonst für die Stammgruppe. Aushilfen zählen dort, wo sie eingeplant
  sind. Urlaub, Krankheit, Fortbildung und Schließtage zählen nicht.
- **Quoten** (z. B. Bayern: mindestens 50 % Fachkräfte) stehen als eigene Zeile mit Soll und Ist.
- Gilt ab einem Datum eine neue Fassung der Vorgabe, nimmt die App für jeden Monat die Fassung, die am Monatsersten
  gilt.

### Reiter „Personalschlüssel“

Unter *Kinder → Planung* hat der Reiter **„Personalschlüssel“** für Leitung und Träger (nicht am Tablet) eine Monatsauswahl.
Je Gruppe stehen Gruppe, Gruppenart, Kinder (davon unter 3), Soll, Ist und Differenz in Vollzeitkräften. **Rot**
heißt: Ist liegt unter Soll („zu wenig“), **grün**: es reicht. Darunter stehen die Zuschläge und Quoten, als letzte
Zeile „Einrichtung gesamt“. Die Hinweise darunter nennen Mitarbeiter ohne Qualifikation, Kinder ohne Betreuungsform,
Kinder ohne passende Vorgabe und den „Stand der Vorgabe“ (Gesetz und Paragraph, gültig ab).
**„Personalschlüssel drucken“** öffnet die Seite zum Drucken (A4 quer, als Ausdruck oder PDF).

In Bremen gibt es keine Monatsrechnung, nur die Mindestbesetzung nach Uhrzeit; der Reiter zeigt dann kein Soll und
Ist.

### Warnungen im Dienstplan

In Ländern mit Mindestbesetzung nach Uhrzeit (z. B. Baden-Württemberg: eine Fachkraft während der ganzen
Öffnungszeit, in VÖ-, Ganztagsgruppe und Krippe in der Hauptbetreuungszeit zwei) prüft die App jede Viertelstunde der
Öffnungszeit: die laut Betreuungsform anwesenden Kinder gegen die eingeplanten Kräfte der Gruppe. Fehlt jemand, steht
beim Tag eine Warnung, zusammengefasst je Zeitraum, z. B. „Bären 7:00–8:00: 1 Fachkraft, nötig 2“. Geprüft werden nur
Betreuungstage mit eingetragenen Öffnungszeiten. Büro- und Vorbereitungszeit zählen nicht als Anwesenheit.

### Einstellungen → Personal → Personalschlüssel

- Leitung und Träger sehen die Zahlen der Vorgabe des Landes, geordnet nach Bedarf (je Altersgruppe oder Gruppenart),
  Mindestbesetzung nach Uhrzeit, Anrechnung je Qualifikation, Zuschlägen, Quoten und Vollzeit-Wochenstunden.
- **Nur der Träger** ändert Zahlen (Dezimalzahlen mit Komma, z. B. 1,8) und speichert. Geänderte Werte sind gelb
  markiert („geändert“, daneben die Vorgabe des Landes). **„zurücksetzen“** nimmt bei einem Wert wieder die Vorgabe,
  **„Alles auf Vorgabe des Landes zurücksetzen“** (mit Rückfrage) bei allen. Die Leitung sieht die Werte nur.
- Ändert das Land später einen Wert, den der Träger geändert hat, gilt ab dann der neue Wert des Landes. Die Änderung
  steht dann unter **„Nicht mehr angewendet (neue Landesvorgabe)“** und lässt sich dort löschen. Ist so eine neue
  Fassung schon bekannt, steht vorher: „Ab ‹Datum› gilt eine neue Landesvorgabe; deine Änderung an … wird dann nicht
  mehr angewendet.“
- Wechselt der Träger das Bundesland der Einrichtung, bleiben nur Änderungen, die im neuen Land dieselbe Vorgabe
  betreffen; Gruppenarten, die es dort nicht gibt, werden entfernt.

### Unsichere Vorgaben

Für einige Länder sind die Zahlen nicht sicher belegt (Hamburg, Saarland, teils Nordrhein-Westfalen, Brandenburg,
Mecklenburg-Vorpommern, Sachsen-Anhalt, Schleswig-Holstein und Thüringen). Dann steht im Reiter und in den
Einstellungen **„Werte des Landes bitte prüfen“**, dazu ein Hinweis, was nicht abgebildet ist. Bitte diese Zahlen mit
dem Landesjugendamt klären und bei Bedarf als Träger anpassen.

**Neue Regeln ab 2027** (Rechtsprüfung vom 19.11.2026; Quellen im Hinweis der jeweiligen Vorgabe):

- **Mecklenburg-Vorpommern ab 01.01.2027:** Krippe **1 : 5** statt 1 : 6 (Fünftes Gesetz zur Änderung des KiföG M-V,
  GVOBl. M-V 2026 S. 758), sonst unverändert. Übergang: Bis längstens 31.07.2029 darf eine Einrichtung nach Anzeige beim
  Jugendamt und Information des Elternrats bei 1 : 6 bleiben – dann trägt der Träger ab 01.01.2027 6 ein. Der Hort-Schritt (1 : 21)
  ist noch nicht übernommen (Datum unklar).
- **Bayern ab 01.01.2027:** neue Fundstellen (Art. 18 BayKiBiG, Gewichte in § 21 AVBayKiBiG; Gesetz vom 28.07.2026,
  GVBl. S. 401), gleiche Werte. Die neu gefasste Anrechnung von Praktikanten und Auszubildenden (§ 16 AVBayKiBiG) ist
  nicht geprüft, deshalb „bitte prüfen“.
- **Brandenburg ab 01.01.2027:** Nach dem Gesetz sinkt der Krippenschlüssel auf 1 : 4; das MBJS hat am 24.08.2026
  mitgeteilt, dass es vorerst bei **1 : 4,25** bleibt. Hinterlegt ist 4,25, mit „bitte prüfen“ (eine Gesetzesänderung
  war bis 19.11.2026 nicht zu finden). Gilt das Gesetz doch, trägt der Träger ab 01.01.2027 4 ein. (Bis zum 19.11.2026 stand ab 2027
  der Wert 4.)
- **Saarland, Nordrhein-Westfalen (ab 01.08.2027), Thüringen:** Die Gesetze ändern sich ab 2027; neue Zahlen waren
  nicht sicher lesbar. Der Hinweis der Vorgabe sagt „Ab 2027 neue Regeln – Werte bitte prüfen“.

## 21. Codes (Urlaub, Krank …)

Die Codes für Abwesenheiten (Urlaub, Krank, Fortbildung …) gelten für **alle Einrichtungen**. Bezeichnung, Farbe und
Anrechnung ändert deshalb **nur der Träger** unter *Einstellungen → Dienstplan → Codes*. Die Leitung sieht die Codes dort nur zum
Lesen (mit dem Hinweis „Codes kann nur der Träger ändern.“).

**Überstundenfrei („ÜF“, violett)** steht direkt hinter Urlaub. Seine Anrechnung ist **„keine“**: ein ganzer Tag ÜF
schreibt nichts gut, das Stundenkonto sinkt also um die Sollstunden des Tages; Urlaubstage werden nicht genommen.
Ganze Tage ÜF trägst du wie Urlaub oder Krank ein: im **Dienstplan**, im **Jahreskalender** (Tag der Person anklicken,
„ÜF“ wählen; dort lässt es sich auch wieder entfernen) und in der **Zeiterfassung** (Menü des Tages). Es ersetzt dabei
wie Urlaub die übrigen Einträge des Tages. Eine Uhrzeit für ÜF gibst du nur im Dienstplan ein.

Für einen **halben Tag ÜF** gehören **der Dienst und die ÜF-Zeit in dieselbe Zelle**, z. B. bei 8 Sollstunden ein
Dienst 8:00–12:00 und dazu ÜF 12:00–16:00 (ÜF mit „Zum bestehenden Eintrag hinzufügen“ eintragen, dann auf den
ÜF-Eintrag klicken und die Zeit eingeben). Das Stundenkonto sinkt um das, was vom Tagessoll nicht gearbeitet ist –
im Beispiel genau die 4 ÜF-Stunden. Steht ÜF mit Uhrzeit allein in der
Zelle, fehlt auch der Rest des Tages: dann sinkt das Stundenkonto um die ganzen Sollstunden. Dienstzeit, die in der
ÜF-Zeit liegt, zählt nicht. In der Zeiterfassung gilt der Beginn bzw. das Ende der ÜF-Zeit als Dienstende bzw.
Dienstbeginn: wer zu Beginn des ÜF geht (oder am Ende eines ÜF am Morgen kommt), gilt nicht als „früher gegangen“ bzw.
„zu spät“. Urlaubsanträge für Überstundenfrei gibt es nur für ganze Tage.

Der Träger kann Bezeichnung, Farbe und Anrechnung wie bei den anderen Codes ändern; der Code selbst bleibt
Überstundenfrei (z. B. für Urlaubsanträge).

### Kinder der Mitarbeiter, „Kind krank“ und Kinderkrankentage

- **Kinder:** In der Personalakte (Reiter „Stammdaten“, Abschnitt **„Kinder“**) stehen die Kinder einer Person mit
  Geburtsdatum, freiwilligem Vornamen und „Kind mit Behinderung, auf Hilfe angewiesen“, dazu **„alleinerziehend“**. Es
  gelten dieselben Rechte wie für Anschrift und Kontakt: Sehen mit dem Recht „Anschrift und Kontakt“, Ändern zusätzlich
  mit „Mitarbeiter pflegen“. „Bearbeiten“ öffnet das Formular, gespeichert wird der ganze Abschnitt auf einmal.
- **Pflegeversicherung:** In „Lohn und Steuer“ stehen darunter, nur zum Lesen, **„Elterneigenschaft: ja/nein“** und
  **„Kinder unter 25 Jahren“** (Stand heute) für den Kinderlosenzuschlag und den Beitragsabschlag ab dem 2. Kind.
- **„Kind krank“** ist ein Code direkt hinter Krank. Er schreibt wie Krank das Tagessoll gut (keine Minusstunden) und
  hat keine Uhrzeit. Im Dienstplan fragt ein kleines Fenster **„Welches Kind?“** (freiwillig; nur bei einer Person und
  nur für alle, die die Kinder sehen dürfen). Angeboten werden die Kinder, die am ersten gewählten Tag unter 12 sind oder eine
  Behinderung haben. Im Jahreskalender erscheint „Kind krank“ wie Krank; Kollegen sehen es dort nicht. Im Kalender und
  in der Zeiterfassung lässt es sich wie Krank eintragen und entfernen (dort ohne Kind).
- **Kinderkrankentage (§ 45 SGB V):** Die Werte stehen unter *Einstellungen → Personal → Kinderkrankentage* und gelten
  für alle Einrichtungen; nur der Träger ändert sie, die Leitung sieht sie nur.
  - **Ohne eigene Werte gilt für jedes Jahr sein gesetzlicher Wert:** bis 2026 15 pro Kind, höchstens 35, alleinerziehend
    30 pro Kind, höchstens 70 (§ 45 Abs. 2a SGB V, nur für 2026 – vorher 2024 und 2025 ebenso); **ab 2027** wieder 10 pro
    Kind, höchstens 25, alleinerziehend 20 pro Kind, höchstens 50 (§ 45 Abs. 2 SGB V). Die Jahre vor 2024 rechnet die App
    wie 2024. So bleibt 2026 bei 15/35, während 2027 mit 10/25 gezählt wird.
  - **Eigene Werte** („Speichern“) gelten für **alle Jahre**, auch die vergangenen und die kommenden: Wer in 2027 10/25
    speichert, senkt damit auch den Anspruch für 2026 nachträglich. Gespeichert wird nur mit „Speichern“ – beim Update
    hat die App nichts gespeichert, ohne Eingabe gelten also die gesetzlichen Werte. Sind Werte von 2026 gespeichert
    (15 oder 35, alleinerziehend 30 oder 70), steht – schon in 2026 – der Hinweis „Diese Werte gelten gesetzlich nur bis
    2026: Ab 2027 gelten wieder 10 / 25 Tage (alleinerziehend 20 / 50). …“. **„Gesetzliche Werte verwenden“** löscht die
    eigenen Werte; danach gilt wieder für jedes Jahr sein gesetzlicher Wert (für 2026 also weiter 15/35).
  - Der Hinweis „Bitte prüfen, ob diese Werte für das Jahr noch gelten (Krankenkasse/Lohnabrechnung).“ bleibt: Verlängert
    der Bundestag die höheren Werte für 2027 doch noch, trägt der Träger sie als eigene Werte ein.
  - Tage, an denen ein Elternteil mit dem Kind im Krankenhaus aufgenommen ist (§ 45 Abs. 1a), und Tage für ein
    unheilbar krankes Kind (§ 45 Abs. 4) sind nicht begrenzt. Die App kann sie nicht von anderen „Kind krank“-Tagen
    unterscheiden und zählt sie mit; der Hinweis im Dienstplan kann dann zu früh kommen. Das steht auch in den
    Einstellungen.
  - Quelle: § 45 SGB V (gesetze-im-internet.de, gelesen 19.11.2026); Stand 19.11.2026, eine Verlängerung für 2027 war
    nicht beschlossen.
  - Es zählen die Kinder, die an mindestens einem Tag des Jahres unter 12 sind, und Kinder mit Behinderung, die auf
    Hilfe angewiesen sind. Anspruch = Tage pro Kind × Zahl der Kinder, aber höchstens der Höchstwert.
  - Genommen sind die **Arbeitstage** der Person mit „Kind krank“ im Jahr, geplante und vergangene.
  - Unter „Urlaub & Zeiten“ steht „Kinderkrankentage ‹Jahr›: ‹genommen› von ‹Anspruch› genommen“, nur wenn die Person
    solche Kinder hat oder Tage genommen hat, und nur mit dem Recht für die Krankheitstage („Mitarbeiter pflegen“).
  - Sind es mehr Tage als der Anspruch, zeigt der Dienstplan am letzten „Kind krank“-Tag des Monats die Warnung
    „‹Name›: ‹n› Kinderkrankentage – Anspruch ‹m› (§ 45 SGB V)“. Wer den Dienstplan bearbeitet, aber die Kinder nicht sehen
    darf, liest nur „‹Name›: Kinderkrankentage über dem Anspruch (§ 45 SGB V)“; wer die Krankheitstage nicht sehen darf,
    bekommt den Hinweis gar nicht (für diese Person ist der Tag nur „abwesend“). Eintragen wird nie verhindert.

### Sonderurlaub mit Begründung

Beim Eintragen von **Sonderurlaub** (im Dienstplan und unter „Urlaub eintragen“) gibt es das Feld **„Begründung“**:
eine Auswahl der üblichen Gründe nach TVöD § 29 mit den üblichen Tagen (z. B. „Umzug aus dienstlichem Grund (1 Tag)“)
oder „Sonstiges“ mit Freitext (höchstens 200 Zeichen). Ein Freitext geht bei jedem Grund.

- **Wer die Begründung sieht:** die Leitung und der Träger (genauer: wer das Recht für die Krankheitstage hat, Baustein
  „Mitarbeiter pflegen“) unter „Urlaub & Zeiten“ bei **„Sonderurlaub ‹Jahr›: ‹n› Tage“**, und die Person selbst unter
  „Mein Urlaub“. Der Dienstplan, das Tablet und die Kollegen sehen nur „Sonderurlaub“.
- **Ändern:** Denselben Zeitraum mit einer Begründung noch einmal eintragen – dann bekommen die Tage die neue Begründung.
  Entfernen geht wie bisher mit „Entfernen“.
- **Löschen:** Die Begründungen gehen mit den persönlichen Daten (Kategorie „Sofort“), die Sonderurlaubstage bleiben für
  das Stundenkonto bei den Zeitdaten.

### BEM (Betriebliches Eingliederungsmanagement, § 167 Abs. 2 SGB IX)

Wer innerhalb eines Jahres **länger als 6 Wochen ununterbrochen oder wiederholt arbeitsunfähig oder teilweise
arbeitsunfähig** war, muss ein BEM angeboten bekommen. Die App zählt mit, erinnert und hält das BEM fest.

> **Gesetzesstand:** § 167 Abs. 2 SGB IX in der Fassung seit **30.07.2026** (Art. 2b des Gesetzes vom 24.07.2026,
> BGBl. 2026 I Nr. 228; Quelle: gesetze-im-internet.de, geprüft 19.11.2026). Neu ist „oder teilweise
> arbeitsunfähig“. Die **teilweise Arbeitsunfähigkeit** (Teil-Krankschreibung zu 25/50/75 %) gibt es aber erst ab
> **01.01.2028**. Bis dahin zählt die App wie bisher nur „Krank“. Spätestens zum 01.01.2028 braucht es einen eigenen
> Abwesenheitscode „Teil-AU“, der beim Zählen mitzählt (ob ein Teil-AU-Tag als ganzer Tag zählt, sagt das Gesetz
> nicht – bitte dann fachlich klären). Die Einladung (Standardtext) nennt den Anlass mit „ununterbrochen oder
> wiederholt arbeitsunfähig“; ein eigener Einladungstext sollte das ebenfalls tun.

**Gesundheitsdaten:** Alles hier sehen nur, wer das Recht für die Krankheitstage hat (Baustein „Mitarbeiter pflegen“, also Leitung und Träger) – nie die Person selbst (es gibt keine
„Meins“-Ansicht), nie Kollegen, nie das Tablet. Das eigene BEM sieht niemand auf seiner eigenen Seite: Das BEM einer
Leitung führt der Träger. Der Server prüft das bei jeder Anfrage.

- **Zählen:** Arbeitstage mit **„Krank“** im Zeitraum **heute − 365 Tage + 1 bis heute**, wie auf der Seite
  „Krankheitstage“: nur Arbeitstage der Person (ihre Wochentage, ohne Feiertage). **„Kind krank“** zählt nicht (keine
  eigene Arbeitsunfähigkeit), **„Im Dienst erkrankt“** auch nicht (der Tag ist dort kein Krankheitstag; ab dem Folgetag
  zählt „Krank“, wenn er eingetragen ist).
- **Grenze:** mehr als 6 Wochen = mehr als **6 × Arbeitstage pro Woche** der heute gültigen Wochenstunden (5 Tage → 30,
  4 → 24, 3 → 18; halbe Werte werden aufgerundet).
- **Neu zählen:** Nach einem BEM, das abgeschlossen, abgelehnt oder unbeantwortet beendet wurde, zählen nur noch die
  Tage **nach** diesem Ende.
- **Erinnerung** im Kasten „Erinnerungen“: „BEM anbieten: ‹Name› war in den letzten 12 Monaten ‹n› Arbeitstage krank
  (mehr als 6 Wochen, § 167 SGB IX)“ mit „zum BEM“. Sie kommt, solange die Grenze überschritten ist und kein BEM läuft,
  und nur für Personen, die heute beschäftigt sind. Läuft ein BEM, erinnert die App, solange es wartet:
  „BEM-Einladung für ‹Name› noch nicht verschickt“ (7 Tage nach „BEM einleiten“ ohne „Verschickt am“) und
  „BEM ‹Name›: Antwortfrist abgelaufen – Antwort eintragen“ (ab dem Tag nach dem Antwortdatum, solange keine Antwort
  eingetragen ist).
- **Mitarbeiter-Seite, Reiter „Nachweise“, Abschnitt „BEM“:** oben „Krankheitstage letzte 12 Monate: ‹n› von ‹Grenze›“
  (gelb ab 80 %, rot darüber). Darunter:
  - **„BEM einleiten“** legt ein BEM an (Stand „eingeladen“). **„Einladung drucken“** öffnet den Brief (A4 hoch, Drucken
    oder PDF): Briefkopf mit Name, Träger, Anschrift und Telefon der Einrichtung (*Einstellungen → Einrichtung →
    Kontakt*), Name und Anschrift der Person (nur wenn gespeichert und wer druckt „Anschrift und Kontakt“ sehen darf,
    sonst leere Zeilen), Ort und Datum, der Text, eine Ansprechperson für Fragen mit Telefon (die Leitung aus Kontakt,
    sonst wer druckt), Grußformel mit Unterschriftszeile und ein Rückantwort-Abschnitt („Ich nehme teil / Ich nehme
    nicht teil“, Unterschrift). Das Datum des Briefs ist „Verschickt am“, solange das nicht eingetragen ist der heutige
    Tag; die Antwort wird bis 14 Tage danach erbeten.
  - **„Verschickt am“**, danach die **Antwort** (angenommen / abgelehnt / keine Antwort, mit Datum). Abgelehnt und keine
    Antwort beenden das BEM; es bleibt als Nachweis mit seinem Stand in der Liste. Weil danach neu gezählt wird, gehen
    beide nur, wenn das Angebot belegt ist: erst „Verschickt am“, und „keine Antwort“ erst ab dem Antwortdatum. Eine
    (mündliche) Zustimmung lässt der Server auch vorher zu.
  - Vor der Zustimmung nur **Notizen** (keine Gesundheitsdaten); nach „angenommen“ auch **Gespräche** (Datum, Beteiligte,
    Notizen) und **Maßnahmen** (Datum, Text, geplant / umgesetzt / verworfen); **„Abschließen“** mit Datum.
    „Zustimmung widerrufen“ (mit „Widerrufen am“) beendet das BEM als „abgelehnt“.
  - Nach einem Widerruf bzw. einer Ablehnung bietet das frühere BEM **„Gesprächsnotizen löschen“** an (mit Rückfrage):
    Beteiligte und Texte aller Gespräche, Maßnahmen und Notizen werden gelöscht; Daten, Art, Stand der Maßnahmen und
    das BEM selbst (Einladung, Antwort, Ende) bleiben als Nachweis.
  - Ein versehentlich eingeleitetes BEM lässt sich löschen, solange die Einladung nicht verschickt ist. Danach ist das
    Angebot der Nachweis: dann bitte die Antwort eintragen (z. B. „keine Antwort“ nach Ablauf der Frist).
  - **Frühere BEM** stehen darunter, nur zum Lesen.
- **Text der Einladung:** *Einstellungen → Personal → BEM-Einladung (Text)* (Leitung und Träger, je Einrichtung).
  Vorbelegt mit allem, worauf § 167 Abs. 2 SGB IX vorher hinzuweisen verlangt: Anlass, Ziel, Freiwilligkeit (jederzeit
  widerrufbar), Vertrauensperson eigener Wahl (Satz 2), mögliche Beteiligte (Betriebsärztin oder Betriebsarzt,
  Personalvertretung, Schwerbehindertenvertretung, Rehabilitationsträger bzw. Integrationsamt – nur mit Zustimmung),
  **Art und Umfang der Daten** (Zahl der Fehltage, Gesprächsnotizen, Maßnahmen; keine Diagnose nötig; Angaben zur
  Gesundheit nur, wenn die Person sie selbst mitteilen möchte), **wer sie sieht** (nur Leitung und Träger, mit Zustimmung
  die genannten Stellen), getrennte Aufbewahrung, Löschung und die Antwortbitte. Fehlen diese Hinweise, gilt das Angebot
  vor Gericht als nicht ordnungsgemäß (BAG 20.11.2014 – 2 AZR 755/13) – ein eigener Text muss sie also behalten.
  Platzhalter: ‹Name›, ‹Antwort bis› und ‹Jahre› (die Löschfrist der BEM-Unterlagen mit Einheit, z. B. „3 Jahre“ oder
  „1 Jahr“). Leer = Standardtext. Bitte den Text vor dem ersten Einsatz mit Personalvertretung bzw. Datenschutz
  abstimmen – auch den Satz „Ablehnung hat keine Nachteile“: Eine Ablehnung kann bei einer späteren krankheitsbedingten
  Kündigung trotzdem eine Rolle spielen.
- **Löschen:** Kategorie **„BEM-Unterlagen“** (voreingestellt 3 Jahre, *Einstellungen → Personal → Löschfristen*), ab
  dem Ende jedes BEM, auch bei Mitarbeitern, die noch da sind; ein laufendes BEM einer ausgeschiedenen Person zählt ab
  dem Austritt. Die Zeile „‹Name› – BEM-Unterlagen (BEM beendet am ‹Datum› – Person noch beschäftigt)“ steht unter
  **Mehr → Löschfristen**; gelöscht werden dabei nur die BEM, deren Frist abgelaufen ist (ein laufendes bleibt). Nichts
  wird automatisch gelöscht. Der Mitarbeiter-Eintrag einer ausgeschiedenen Person wird erst löschbar, wenn auch ihre
  BEM-Unterlagen gelöscht sind. „Endgültig löschen“ löscht alle BEM der Person mit. Eine Löschfristen-Seite, die vor dem
  Update geöffnet war, speichert ohne die BEM-Jahre – dann bleiben die gespeicherten.
- Ein BEM zieht mit der Person in eine andere Einrichtung um (es gehört zur Person, nicht zur Einrichtung).

**Datenbank (Migration 0092):** neue Tabellen „bem_processes“ und „bem_steps“ (gehen mit der Person), die Spalte
„facilities.bem_invitation_text“ (leer = Standardtext) und „retention_settings.bem_years“ (3).

**Hinweis zur Datenbank (Migration 0086):** Die Migration 0086 („Kinder der Mitarbeiter“) wurde nach 0087 gespeichert.
Ihr Zeitstempel liegt deshalb zwischen 0087 und 0088, damit eine Datenbank, die 0087 schon hatte, 0086 noch nachholt.
Eine Datenbank, die 0088 vor 0086 bekommen hätte (nur aus einem unfertigen Zwischenstand möglich), würde 0086 überspringen:
dann fehlen die Tabelle „employee_children“ und die Spalte „entries.employee_child_id“. Aus dem gespeicherten Stand der
Versionsverwaltung kann das nicht passieren.

## 22. Warnungen im Dienstplan (die Liste rechts)

Leitung und Träger sehen rechts neben dem Dienstplan (am Handy darunter) die **Warnungen** des Monats. Mitarbeiter
sehen keine Warnungen.

- **Drei Gruppen**, oben gezählt („Besetzung 6 · Lücken 40 · Zeiterfassung 27“), jede auf- und zuklappbar:
  **Besetzung** (Pflichtdienste, Öffnung/Schließung, Personalschlüssel nach Uhrzeit), **Dienstplan-Lücken** (kein
  Eintrag, Sollstunden nicht erreicht) und **Zeiterfassung** (Ausstempeln vergessen, keine Stempelzeit, Pause, gestempelt
  ohne Dienst).
- **Zusammengefasst:** Dieselbe Warnung an aufeinanderfolgenden Tagen steht in einer Zeile, z. B.
  „Mo 05.–Fr 09.10. · Bären 7:00–8:00: 1 Fachkraft, nötig 2“ oder „Anna · 12 Tage ohne Eintrag (01.–16.10.)“.
  Wochenenden, Feiertage und Schließtage dazwischen unterbrechen das nicht; andere Zahlen (z. B. 0 statt 1 Fachkraft)
  beginnen eine neue Zeile. Bei den Sollstunden wird die fehlende Zeit zusammengezählt („7 Tage, zusammen 9:30 h zu
  wenig“).
- **Vergangene Tage** stehen bei Besetzung und Lücken zugeklappt unter „vergangene Tage (n)“; zuerst kommt ab heute.
  Bei der Zeiterfassung zählt gerade die Vergangenheit, sie steht dort ganz normal.
- **Klick auf eine Zeile** springt zum Tag im Plan (bei mehreren Tagen zum ersten) und hebt ihn kurz hervor.
- **Filter** nach Gruppe und Mitarbeiter gelten für alle drei Gruppen; das Gerät merkt sich die Auswahl. Mit einer
  Gruppe gewählt bleiben die Warnungen der ganzen Einrichtung (Pflichtdienste und Öffnung/Schließung der Einrichtung)
  sichtbar; dazu kommen die Warnungen der Gruppe und ihrer Mitarbeiter (Springer gehören zu keiner Gruppe).
- Teilzeitkräfte: Ihre freien Wochentage unterbrechen eine zusammengefasste Zeile nicht.
- **„Zur Kenntnis genommen“** (Haken rechts an der Zeile) blendet die Warnung für die ganze Einrichtung aus, bei einer
  zusammengefassten Zeile für alle ihre Tage. Gespeichert wird, wer es wann gemacht hat. Ändert sich an der Warnung
  etwas (z. B. andere Zahlen, andere fehlende Zeit, anderer Zeitraum), erscheint sie wieder. Die Zahl in der
  Überschrift zählt nur die nicht zur Kenntnis genommenen. **„zur Kenntnis genommene anzeigen (n)“** zeigt sie grau, mit
  **„Rückgängig“**. Welche Warnungen es gibt, ändert sich dadurch nicht (auch nicht die Markierungen im Plan).

### Arbeitszeitgesetz: höchstens 10 Stunden am Tag, 6 Stunden am Stück, 11 Stunden Ruhezeit (nur Hinweise)

Die App weist darauf hin, verhindert aber nichts: Speichern, Freigeben und Stempeln gehen weiter.

- **Höchstens 10 Stunden am Tag (§ 3 ArbZG):** Sind für eine Person an einem Tag mehr als 10 Stunden Arbeit geplant,
  steht in den Hinweisen des Tages z. B. „Anna: 10:45 Std. geplant – erlaubt sind höchstens 10 Std. (§ 3 ArbZG)“.
  Genau 10:00 Stunden sind erlaubt. Gezählt werden Dienste, Sonderdienste, VZ, Büro, Arzt und Homeoffice, ohne Pausen
  und ohne die Zeit von „Überstundenfrei“; was sich überschneidet, zählt einmal. **Fortbildung und Schule mit Uhrzeit**
  zählen hier auch als Arbeitszeit (nach dem Arbeitszeitgesetz sind sie es) – im Stundenkonto zählen sie weiter das
  Tagessoll. Urlaub, Krank, Feiertag, Schließtag und ganze Tage ohne Uhrzeit (z. B. „Büro (ganzer Tag)“, Fortbildung
  ohne Uhrzeit) zählen hier keine Stunden. Ein Aushilfstag in einer anderen Einrichtung zählt mit.
- **11 Stunden Ruhezeit (§ 5 ArbZG):** Zwischen dem Ende der letzten Arbeit eines Tages und dem Beginn der ersten
  Arbeit am nächsten Tag müssen mindestens 11 Stunden liegen. Sonst steht am späteren Tag z. B. „Anna: nur 9:00 Std.
  Ruhezeit zwischen 22:00 (Mo) und 7:00 (Di) – mindestens 11 Std. (§ 5 ArbZG)“. Einträge ohne Uhrzeit zählen dafür
  nicht. Arzt, Homeoffice sowie Fortbildung und Schule mit Uhrzeit zählen als Arbeit. Am Monatsersten wird mit dem
  letzten Tag des Vormonats verglichen.
- **Nicht länger als 6 Stunden ohne Pause (§ 4 Satz 3 ArbZG):** Ist für eine Person mehr als 6 Stunden am Stück Arbeit
  geplant, ohne dass eine Pause dazwischen liegt, steht z. B. „Anna: 6:30 Std. ohne Pause geplant – länger als 6 Std. am
  Stück nur mit Ruhepause (§ 4 ArbZG, Pausen ab 15 Min.)“. Genau 6:00 Stunden sind erlaubt. Als Pause zählt – wie bei der
  Pausenlänge (§ 4 Satz 2) – nur eine Unterbrechung von **mindestens 15 Minuten**: die Pause eines Dienstes, eine
  zusätzliche Pause oder eine Lücke zwischen zwei Einträgen. Gezählt wird nur die Arbeit (Dienste, Sonderdienste, VZ,
  Büro, Arzt, Homeoffice), **nicht Schule und Fortbildung** – deren Pausen stehen nicht im Plan (ein Schultag 8:00–14:30
  gibt also keinen Hinweis); sie unterbrechen die Arbeit wie eine Pause.
  Für **unter 18-Jährige** gilt an diesen Tagen stattdessen die strengere Regel des Jugendarbeitsschutzes (höchstens
  4:30 Std. am Stück, § 11 JArbSchG) – sie bekommen nicht beide Hinweise. Der Hinweis kommt nur aus dem Dienstplan; für
  gestempelte Tage gibt es weiter „gesetzliche Pause nicht eingehalten“. Stand der Regel: 19.11.2026 (ArbZG, zuletzt
  geändert 23.10.2024; eine Reform ist nicht in Kraft).
- **Auch am Wochenende und an Feiertagen** wird geprüft, nur für eigene Mitarbeiter (Aushilfen aus einer anderen
  Einrichtung prüft deren Einrichtung).
- **Zeiterfassung:** Für vergangene Tage ab „Zeiterfassung ab“ prüft die App dasselbe mit den gestempelten Zeiten
  (dazu Homeoffice und Arzt, bei automatischer Pause ohne die abgezogene Pause): „Anna: 10:30 Std. gearbeitet – mehr
  als 10 Std. (§ 3 ArbZG)“ bzw. die Ruhezeit wie oben. Diese Hinweise stehen in der Zeiterfassung und in den Hinweisen
  des Tages im Dienstplan – nur für Leitung und Träger. Hat ein vergangener Tag Stempelzeiten, zählen nur sie: Der
  Dienstplan zeigt für diesen Tag dann nicht zusätzlich den Hinweis aus den geplanten Zeiten. Ein Tag vor
  „Zeiterfassung ab“ wird nicht verglichen. Tage mit Urlaub, Krank usw. oder „Im Dienst erkrankt“ bekommen keinen
  Hinweis aus Stempelzeiten (für sie gilt der Plan); das Gehen an einem Tag mit „Im Dienst erkrankt“ zählt auch nicht für
  die Ruhezeit bis zum nächsten Tag. War am Vortag Fortbildung oder Schule mit Uhrzeit, zählt deren Ende.
- **Beim Eintragen:** Im Fenster für einen Sonderdienst, VZ, Büro oder Arzt und beim Ändern eines Eintrags steht unter
  Arbeitszeit und Pause „Mehr als 10 Std. an diesem Tag (§ 3 ArbZG)“, sobald es mit den übrigen Einträgen des Tages
  mehr als 10 Stunden wären.
- **„Zur Kenntnis genommen“** geht wie bei den anderen Hinweisen; ändern sich die Stunden oder Uhrzeiten, erscheint der
  Hinweis wieder.

### Mutterschutz (MuSchG)

Eine Schwangerschaft ist ein Gesundheitsdatum. Den Abschnitt **„Mutterschutz“** im Reiter „Nachweise“ der
Mitarbeiterseite sehen nur Leitung und Träger (Recht „Krankheitstage …“, `employees.sickness`), nie auf der eigenen
Seite: Den Mutterschutz einer Leitung trägt der Träger ein. Der Server prüft das bei jeder Anfrage; das Tablet und
Mitarbeiter kommen nicht heran.

- **Eintragen:** Bekanntgabe am (der Tag, an dem die Mitarbeiterin es mitgeteilt hat), voraussichtlicher
  Entbindungstermin, später der Tag der Entbindung, „12 Wochen“ (Früh- oder Mehrlingsgeburt, Behinderung des Kindes),
  freiwillig „Stillzeit bis“, die Tage der Meldung an die Aufsichtsbehörde (§ 27) und der Gefährdungsbeurteilung (§ 10),
  ein Beschäftigungsverbot (keines, teilweise, vollständig; von, bis, Notiz), eine **Fehlgeburt** (Tag,
  Schwangerschaftswoche, „verzichtet“) und „Beendet am“ (z. B. wenn die Mitarbeiterin ausscheidet). Daten in der Zukunft
  gehen nicht für Bekanntgabe, Entbindung, Fehlgeburt, Meldung und Gefährdungsbeurteilung; der Tag der Entbindung muss
  zum Termin passen (höchstens 26 Wochen davor, 9 Wochen danach – fängt Tippfehler im Jahr ab).
- **Schutzfristen (§ 3):** vor der Entbindung 6 Wochen (42 Tage) vor dem voraussichtlichen Termin bis zum Tag vor der
  Entbindung (bei späterer Geburt entsprechend länger); nach der Entbindung der Tag der Entbindung und 8 Wochen danach
  (Termin + 56 Tage, mit der Frist davor 99 Tage), mit Häkchen 12 Wochen (+ 84 Tage). Kommt das Kind früher, werden die
  nicht genommenen Tage der Frist vor der Entbindung hinten angehängt (§ 3 Abs. 2 Satz 3) – das Ende bleibt dann gleich.
  Die App zeigt beide Fristen beim Eintrag an.
- **Fehlgeburt (§ 3 Abs. 5, seit 1. Juni 2025):** ab der 13. Schwangerschaftswoche 2 Wochen, ab der 17. Woche 6 Wochen,
  ab der 20. Woche 8 Wochen Schutzfrist ab dem Tag der Fehlgeburt (vor der 13. Woche keine). Ab der 24. Woche gilt eine
  Totgeburt als Entbindung: dann den Tag der Entbindung eintragen (volle Schutzfrist nach der Entbindung); als Fehlgeburt
  nimmt die App höchstens die 23. Woche an. Die Mitarbeiterin darf
  ausdrücklich erklären, dass sie arbeiten möchte: dann „verzichtet“ ankreuzen – es gibt keine Schutzfrist, eingetragene
  Tage werden entfernt. Mit der Fehlgeburt endet die Schwangerschaft: Hinweise gelten bis zum Tag davor bzw. bis zum Ende
  dieser Frist.
- **Codes:** „Mutterschutz“ und „Beschäftigungsverbot“ stehen direkt hinter „Kind krank“. Beide sind ganze Tage, die wie
  Krank das Tagessoll gutschreiben (keine Minusstunden), zählen nicht als Anwesenheit und nicht als Urlaub. Bestehende
  Datenbanken bekommen die Codes mit der Migration 0093.
- **Wer die Codes sieht – „Alles Private als ‚abwesend‘“:** Krank, Kind krank, Mutterschutz und Beschäftigungsverbot
  sieht nur, wer die Krankheitstage sehen darf (`employees.sickness`, Leitung und Träger). Alle anderen – Mitarbeiter, die
  Gruppenleitung, wer nur „Dienstplan bearbeiten“ oder die Zeiterfassung hat – und **immer das Tablet** sehen an diesen
  Tagen für alle vier dasselbe graue **„abwesend“** (ohne Notiz, ohne Kürzel): im Dienstplan (Entwurf und freigegebener
  Plan, auch beim Drucken und als PDF), in der Änderungsliste der Freigaben, im Jahreskalender und in der Urlaubsplanung
  („abwesend“; die Legende nennt „Krank“ und „Mutterschutz / Beschäftigungsverbot“ nur, wenn solche Tage gezeigt werden),
  in der Zeiterfassung und in der Tagesübersicht. Die Markierung „Im Dienst erkrankt“ und der Hinweis zu den
  Kinderkrankentagen fehlen für sie; in der Zeiterfassung steht an einem solchen Tag nur „zählt nach Plan“ – derselbe
  Vermerk wie an jedem gestempelten Tag, der nach Plan zählt (z. B. ein ganzer Büro- oder Homeoffice-Tag). Der Server schickt ihnen weder den Code noch seinen Namen, so dass „abwesend“ nicht
  verrät, welcher Grund es ist. Wer selbst betroffen ist, sieht unter „Mein Dienstplan“ und im eigenen Jahreskalender die
  eigenen Einträge, wie sie sind. Die vier Codes werden diesen Personen nicht zum Eintragen angeboten, und sie können
  einen solchen Tag nicht ändern, überschreiben oder löschen („Diesen Tag kann nur ändern, wer die Krankheitstage sehen
  darf“).
  **„Krank melden“** ist die eine Ausnahme: Wer den Dienstplan bearbeiten darf, aber das Recht „Krankheitstage …“ nicht
  hat (z. B. die Gruppenleitung), bekommt im Dienstplan statt der vier Codes den Knopf „Krank melden“ (in der Leiste und
  im Zellmenü, nicht bei Aushilfen). Er trägt nach einer Rückfrage „Krank“ ein – auf leere Tage, auf Tage mit Diensten
  oder anderen Codes (die wie beim Eintragen von Krank ersetzt werden) und auf Tage, an denen die Person woanders aushilft.
  Danach steht dort auch für diese Person nur „abwesend“; ändern, löschen oder überschreiben kann den Tag – auch den
  selbst gemeldeten – nur noch, wer das Recht hat. Kind krank, Mutterschutz und Beschäftigungsverbot kann sie nicht
  eintragen. Sind unter den ausgewählten Tagen schon Tage „abwesend“, bleiben genau diese unverändert, die übrigen werden
  eingetragen, und es erscheint der Hinweis „Einige Tage sind bereits als abwesend eingetragen und wurden nicht
  geändert.“ – ohne zu sagen, welche Tage oder warum (sie sieht sie ohnehin alle gleich als „abwesend“). Sind alle
  ausgewählten Tage schon „abwesend“, kommt die bekannte Meldung „Diesen Tag kann nur ändern …“. Alles andere (ein
  Dienst, Leeren, ein anderer Code) über eine Auswahl mit einem solchen Tag wird wie bisher ganz abgelehnt. Die
  Änderungsliste nach der Freigabe hält die Meldung wie jede andere Änderung fest; Leitung und Träger sehen dort und im
  Plan ganz normal „Krank“. Wer das Recht hat, trägt alle vier Codes wie bisher ein. In einer anderen Einrichtung, in
  der die Person aushilft, sieht man an einem solchen Tag wie an jedem anderen Tag ihrer eigenen Einrichtung nur „belegt“.
  Eine **Schließzeit** wird für alle
  eingetragen, ohne Fehlermeldung, lässt aber jeden Tag mit Krank, Kind krank, Mutterschutz oder Beschäftigungsverbot
  stehen: Während Krankheit und Schutzfrist wird kein Urlaub verbraucht (§ 9 BUrlG, § 24 MuSchG), und „abwesend“ bleibt für
  alle vier gleich. Wird jemand erst nach dem Anlegen der Schließzeit krank, wird der Tag wie bisher umgetragen. Die
  Seite „Krankheitstage“ und die BEM-Erinnerungen bleiben wie bisher. Stunden und Hinweise rechnet der Server immer mit
  den echten Einträgen.
  **Wochenvorlagen** nehmen die beiden Codes nie auf (Vorlagen sind für regelmäßige Dienste): „Woche als Vorlage
  speichern“ lässt sie für alle weg, der Vorlagen-Editor bietet sie nicht an und lehnt sie ab, und sollte eine alte
  Vorlage doch einen solchen Eintrag enthalten, wird er weder angezeigt noch beim Füllen einer Woche eingetragen.
- **„Schutzfristen eintragen“** (nur mit „Dienstplan bearbeiten“) trägt „Mutterschutz“ an den Arbeitstagen beider
  Fristen ein – wie „Urlaub eintragen“: Schließtage, Wochenenden, Feiertage und freie Tage nicht, Krank, Fortbildung u. Ä.
  bleiben stehen, ein eingetragenes Beschäftigungsverbot wird ohne Rückfrage ersetzt. **Dienste und Urlaub** werden nur
  nach Rückfrage ersetzt; die Frage nennt die Urlaubstage, die **zurückgegeben** werden (Urlaub in der Schutzfrist bzw. im
  Beschäftigungsverbot geht nicht, § 24 MuSchG – Urlaub, Sonderurlaub und Überstundenfrei werden durch den Code ersetzt
  und zählen damit nicht mehr als genommen). Ein dazu genehmigter Urlaubsantrag bleibt als „genehmigt“ stehen – bitte
  der Mitarbeiterin Bescheid geben.
- **Ändern sich danach die Angaben** (Tag der Entbindung, 12 Wochen, Termin, Fehlgeburt, Verbot, „Beendet am“), trägt
  die App beim Speichern nach – auch wenn die Tage gleich bleiben, z. B. bei einer früheren Geburt:
  - Tage, die nicht mehr in den Fristen liegen, verlieren ihren Eintrag (nur diesen Code);
  - neue Tage und alle freien Tage der Schutzfrist nach der Entbindung bekommen „Mutterschutz“;
  - **Dienste in der Schutzfrist nach der Entbindung** (z. B. Tage, an denen sie vor der erwarteten Geburt arbeiten
    wollte, die nach einer früheren Geburt jetzt danach liegen) werden nie stillschweigend übergangen: Die App meldet
    „‹n› Dienste liegen in der Schutzfrist nach der Entbindung … und müssen entfernt werden“ und bietet an, sie durch
    „Mutterschutz“ zu ersetzen; im Dienstplan steht an jedem dieser Tage ein Hinweis (siehe unten);
  - Dienste auf neuen Tagen **vor** der Entbindung und Urlaub auf neuen Tagen bleiben und werden mit dem Knopf genannt,
    der sie ersetzt („Schutzfristen eintragen“ bzw. „Beschäftigungsverbot eintragen“);
  - mit **„Beendet am“** werden die eingetragenen Tage danach entfernt (die App fragt vorher).
- **Ohne „Dienstplan bearbeiten“** (z. B. ein Träger-Recht ohne Planrecht) wird der Eintrag gespeichert, der Dienstplan
  aber nicht geändert: Die App sagt „Dienstplan muss noch angepasst werden“, der Eintrag zeigt es an, und wer beides
  darf, bekommt die Erinnerung „Dienstplan muss noch angepasst werden: Mutterschutz von ‹Name›“. „Schutzfristen
  eintragen“ holt das nach – auch das Entfernen von Tagen, die nicht mehr in den Fristen liegen.
- **Löschen eines Eintrags:** Die App fragt, ob auch die eingetragenen Tage aus dem Dienstplan entfernt werden sollen
  (nur die Codes Mutterschutz und Beschäftigungsverbot). Einen Eintrag, der Tage eingetragen hat, kann nur löschen, wer
  „Dienstplan bearbeiten“ darf – sonst blieben die Tage ohne Hinweis stehen. Die „zur Kenntnis genommenen“
  Hinweise des Eintrags gehen mit.
- **Vor der Entbindung** darf die Mitarbeiterin auf eigenen Wunsch arbeiten: Dann den Tag im Dienstplan einfach ändern
  (keine Warnung). Beim Nachtragen bleibt ein solcher Dienst stehen, solange der Tag vor der Entbindung liegt.
- **„Beschäftigungsverbot eintragen“** gibt es nur beim vollständigen Verbot: „Beschäftigungsverbot“ an den Arbeitstagen
  von „Verbot von“ bis „Verbot bis“, nie an Tagen der Schutzfristen (dort gilt Mutterschutz). Ohne „Verbot bis“ läuft es
  in der Schwangerschaft bis zum Tag vor der Schutzfrist, nach der Entbindung bis „Stillzeit bis“. Ein teilweises Verbot
  ist nur eine Notiz am Eintrag: Die Dienste werden kürzer oder anders geplant, im Dienstplan wird nichts eingetragen.
  Wird das Verbot geändert oder zurückgenommen, trägt die App wie oben nach.
- **Hinweise im Dienstplan (§§ 3–6):** von der Bekanntgabe bis zum Ende der Schutzfrist nach der Entbindung und in der
  Stillzeit (bis „Stillzeit bis“), nicht nach „Beendet am“, aus den geplanten Einträgen (Arbeitszeit wie bei den
  Arbeitszeitgesetz-Hinweisen):
  - **jede Arbeit in der Schutzfrist nach der Entbindung:** „‹Name›: Beschäftigungsverbot nach der Entbindung (§ 3
    MuSchG)“ (nach einer Fehlgeburt „Schutzfrist nach der Fehlgeburt (§ 3 Abs. 5 MuSchG)“) – an diesen Tagen statt der
    Stundenhinweise, denn es gilt keine Höchstgrenze, sondern ein Verbot;
  - **jede Arbeit an einem Tag eines vollständigen Beschäftigungsverbots:** „‹Name›: Dienst trotz Beschäftigungsverbot
    (§§ 13, 16 MuSchG)“;
  - mehr als 8:30 Std. an einem Tag, unter 18 Jahren (aus Geburtstag und Geburtsjahr) mehr als 8 Std.:
    „‹Name›: 9:00 Std. – in der Schwangerschaft höchstens 8,5 Std. (§ 4 MuSchG)“ (in der Stillzeit „in der Stillzeit“),
  - mehr als 90 Std. in einer Doppelwoche (unter 18: 80 Std.): „‹Name›: ‹h:mm› Std. in der Doppelwoche – höchstens
    90 Std. (§ 4 MuSchG)“, geprüft wird jede Doppelwoche ab einem Montag (nur Tage, an denen der Mutterschutz gilt), der
    Hinweis steht an ihrem letzten Tag,
  - Arbeit nach 20 Uhr oder vor 6 Uhr: „‹Name›: Arbeit nach 20 Uhr (§ 5 MuSchG)“ bzw. „… vor 6 Uhr …“,
  - Arbeit an Sonntagen und Feiertagen der Einrichtung: „‹Name›: Sonn-/Feiertagsarbeit (§ 6 MuSchG)“,
  - weniger als 11 Std. Ruhezeit nach dem Vortag: „‹Name›: nur ‹h:mm› Std. Ruhezeit (§ 4 MuSchG)“,
  - im Monatsdurchschnitt mehr als die vertragliche Wochenarbeitszeit: „‹Name›: Ø ‹h:mm› Std./Woche im ‹Monat› – mehr als
    vertraglich (§ 4 MuSchG)“, am letzten Tag des Monats, für den der Mutterschutz gilt. Verglichen werden die geplanten
    Stunden dieser Tage mit den vertraglichen Stunden derselben Tage (Wochenstunden ÷ 7 je Tag); Urlaub, Krank usw.
    zählen als 0 Stunden.

  Die Hinweise verhindern nichts und lassen sich wie die anderen „zur Kenntnis nehmen“ (das geht nur mit dem Recht).
  **Wer den Dienstplan bearbeitet, den Mutterschutz aber nicht sehen darf**, liest nur „‹Name›: Arbeitszeitgrenze
  überschritten“ – einmal je Person und Tag, ohne Regel und ohne Grund; die „zur Kenntnis genommenen“ Mutterschutz-
  Hinweise bekommt diese Person nicht geschickt. Ändern sich die geplanten Stunden des Tages, erscheint der neutrale
  Hinweis wieder. (Eine Leitung, die ihn so zur Kenntnis nimmt, erledigt damit nicht den Hinweis mit Grund und
  umgekehrt.) Die Zeiterfassung zeigt keine eigenen Mutterschutz-Hinweise; die Hinweise des Arbeitszeitgesetzes gelten
  daneben weiter.
- **Restrisiko:** Auch ohne Grund kann jemand Rückschlüsse ziehen – z. B. weil „Arbeitszeitgrenze überschritten“ nur bei
  einer Person und schon bei Dingen erscheint, die das Arbeitszeitgesetz erlaubt (8:45 Std., 20:15 Uhr, ein Sonntag),
  oder weil eine Kollegin über Wochen „abwesend“ ist. Auch „Im Dienst erkrankt“ hinterlässt Spuren: Im Dienstplan zählt
  ein solcher Tag nach Plan und wird nicht als abweichend markiert, in der Zeiterfassung fehlen an ihm Hinweise und die
  Markierung „früher gegangen“, und er trägt nur „zählt nach Plan“. Bei einem Dienst (kein ganzer Büro-Tag) mit wenigen
  gestempelten Stunden lässt das auf eine Krankheit schließen. Die App verrät den Grund nicht, kann solche Schlüsse aber
  nicht verhindern. Gib „Krankheitstage …“ deshalb nur Leitung und Träger. Datensicherungen enthalten alles.
- **Erinnerungen** (Box „Erinnerungen“, nur Leitung und Träger mit dem Recht, nicht am Tablet, nie zur eigenen Person,
  nicht für Ausgeschiedene): „Gefährdungsbeurteilung für ‹Name› erstellen/anpassen (§ 10 MuSchG)“ bis der Tag
  eingetragen ist (14 Tage nach der Bekanntgabe rot); „‹Name›: Meldung an die Aufsichtsbehörde (§ 27 MuSchG) –
  unverzüglich“ bis der Tag eingetragen ist (ab dem Tag nach der Bekanntgabe rot) – beide auch nach dem Ende des
  Mutterschutzes, bis sie erledigt sind; solange der Mutterschutz gilt, einmal je Eintrag „‹Name›: Beschäftigungsverbot
  prüfen (z. B. Immunität gegen Röteln, Ringelröteln, Windpocken, Zytomegalie)“ bis „Geprüft“ getippt oder ein Verbot
  (teilweise oder vollständig) eingetragen ist; und für wer auch den Dienstplan bearbeiten darf „Dienstplan muss noch
  angepasst werden …“ (siehe oben).
- **Urlaub (§ 24):** Schutzfristen und Beschäftigungsverbot kürzen den Urlaub nicht; die Codes zählen nicht als
  genommener Urlaub, und Urlaub in den Fristen wird beim Eintragen zurückgegeben (siehe oben). Am Eintrag steht
  „Resturlaub nach dem Mutterschutz bleibt erhalten (§ 24 MuSchG).“ Den Verfall von Resturlaub nach dem Mutterschutz
  rechnet die App nicht gesondert – bitte beim Verfallshinweis daran denken.
- **Löschfristen:** eigene Kategorie **„Mutterschutz-Unterlagen“** (Einstellungen → Löschfristen, Vorgabe **2 Jahre**,
  vgl. § 27 Abs. 5 MuSchG): Ein Eintrag darf so viele Jahre nach seinem Ende gelöscht werden (Ende der Schutzfrist nach
  der Entbindung bzw. der Stillzeit oder „Beendet am“; bei einer Fehlgeburt das Ende ihrer Frist), **auch bei
  Mitarbeiterinnen, die noch da sind**; ein laufender Mutterschutz einer Ausgeschiedenen zählt ab dem Austritt. Die
  Einträge stehen unter Mehr → Löschfristen („Mutterschutz beendet am …“); gelöscht werden nur die fälligen. Die Codes im
  Dienstplan gehen mit den Zeitdaten; „Endgültig löschen“ löscht alles sofort.

### Jugendarbeitsschutz (JArbSchG)

Für Mitarbeitende **unter 18** prüft die App den Dienstplan zusätzlich nach dem Jugendarbeitsschutzgesetz. Das Alter
rechnet sie aus dem **Geburtstag mit Jahr** (Stammdaten; das Jahr gehört zur Personalakte, „Anschrift, Kontakt und
Geburtsdatum“). Ab dem 18. Geburtstag gelten die Regeln nicht mehr (der Geburtstag selbst zählt schon; am 29. Februar
Geborene sind in einem Gemeinjahr ab dem 1. März 18). Ist nur das **Geburtsjahr** eingetragen, gelten die Regeln, solange
das Jahr höchstens 17 Jahre nach dem Geburtsjahr liegt (dann ist die Person sicher unter 18); im Jahr des 18. Geburtstags
weiß die App es nicht und prüft nichts, ab dem Jahr danach ist sie sicher 18. Ohne Geburtsjahr prüft sie nichts. Alles sind
**nur Hinweise**, nichts wird gesperrt, und das ist **keine Rechtsberatung**. Das Alter ist kein Gesundheitsdatum: Die
Hinweise sieht jeder, der den Dienstplan bearbeitet, wie die ArbZG-Hinweise – das Geburtsdatum steht in keinem Hinweis.
Wer die Pflichttermine sieht, kann an den Untersuchungen (siehe unten) erkennen, dass jemand unter 18 ist.

- **„Geburtsjahr fehlt – Jugendarbeitsschutz kann nicht geprüft werden“:** bei Auszubildenden, Studierenden
  (praxisintegriert), Berufspraktikanten und „keine pädagogische Kraft“ ohne Geburtsjahr. Ohne eingetragene Qualifikation
  oder bei Fachkräften, Ergänzungskräften und Haushaltskräften kommt er nicht.
- **„Geburtstag fehlt – Jugendarbeitsschutz kann nicht sicher geprüft werden“:** bei jedem (gleich welche Qualifikation)
  mit Geburtsjahr, aber ohne Geburtstag, im Jahr des 18. Geburtstags.
- Beide Hinweise stehen beim Mitarbeiter unter dem Geburtstag und einmal im Monat in den Hinweisen des Dienstplans (am
  ersten Arbeitstag des Monats, für den es zutrifft) – nur für alle, die das Geburtsjahr eintragen dürfen („Anschrift,
  Kontakt und Geburtsdatum“).
- **Arbeitszeit** zählt wie bei den ArbZG-Hinweisen: Dienste ohne Pausen und Überstundenfrei, Fortbildung mit Uhrzeit;
  Schule mit Uhrzeit zählt **mit ihren Pausen** (§ 9 Abs. 2: Unterrichtszeit einschließlich der Pausen). Ganztägige
  Abwesenheiten (Urlaub, Krank, Kind krank …) zählen nicht und verraten nichts.
- **Hinweise im Dienstplan** (jeweils mit „Zur Kenntnis genommen“, je Regel und Tag; ändert sich der Wert, erscheint der
  Hinweis wieder):
  - **8 Stunden am Tag (§ 8):** mehr als 8:00 Std. (Schule mitgerechnet) – „Lena: 8:30 Std. geplant – unter 18 höchstens
    8 Std. am Tag (§ 8 JArbSchG)“. Bis 8:30 Std. sind erlaubt, wenn ein anderer Werktag (Mo–Sa) derselben Woche mit Arbeit
    kürzer als 8 Std. ist (§ 8 Abs. 2a); ein freier Tag zählt dafür nicht.
  - **40 Stunden in der Woche (§ 8):** an dem Tag, an dem die Kalenderwoche (Mo–So) 40 Std. überschreitet, mit der Summe
    der Woche. Schule zählt mit (§ 9 Abs. 2): mit ihrer Unterrichtszeit samt Pausen; ein langer Berufsschultag (siehe
    unten) mit der **durchschnittlichen täglichen Arbeitszeit** aus dem Vertrag (Wochenstunden ÷ Arbeitstage pro Woche,
    z. B. 39 Std. an 5 Tagen → 7:48 Std.; ohne Wochenstunden 8 Std.), und zwar der freie lange Schultag der Woche (sonst
    der erste); ein Schultag ohne Uhrzeit ebenso.
  - **5 Tage in der Woche (§ 15):** am sechsten Tag mit Arbeit oder Schule.
  - **6 bis 20 Uhr (§ 14):** Arbeit vor 6:00 oder nach 20:00. Schule ist dabei keine Arbeit (auch Abendunterricht nicht).
  - **Samstag, Sonntag, Feiertag (§§ 16–18):** jede Arbeit an diesen Tagen (Feiertage der Einrichtung) – nur ein
    Hinweis, weil es Ausnahmen gibt (eine Kita ist kein Heim im Sinne von § 16 Abs. 2 / § 17 Abs. 2). Schule an einem
    Samstag gibt keinen Hinweis.
  - **24. und 31. Dezember (§ 18 Abs. 1):** Arbeit nach 14:00 – „Lena: Arbeit bis 16:00 Uhr am 24.12. – unter 18 nicht
    nach 14 Uhr (§ 18 JArbSchG)“.
  - **12 Stunden Freizeit (§ 13):** zwischen dem Ende der Arbeit (oder Schule) des Vortags und dem Beginn am Tag.
  - **Pausen (§ 11):** bei mehr als 4:30 Std. Arbeit mindestens 30 Min., bei mehr als 6 Std. mindestens 60 Min.; es zählen
    nur Pausen ab 15 Min. (Pause des Dienstes, zusätzliche Pausen, Lücken zwischen Diensten), und höchstens 4:30 Std.
    am Stück ohne Pause (kürzere Unterbrechungen zählen mit). Es zählen die **im Dienstplan eingetragenen** Pausen – das
    Gesetz will sie im Voraus festgelegt; der automatische Pausenabzug der Zeiterfassung zählt dafür nicht. Die Schulzeit
    bleibt bei den Pausen außen vor (die Pausen der Schule regelt die Schule).
  - **Berufsschule (§ 9):** Ein Tag mit „Schule“ und **mehr als fünf Unterrichtsstunden**, also mindestens 6 × 45 = 270 Min.
    Unterricht (Zeit des Eintrags ohne seine Pause), oder ohne Uhrzeit gilt als **langer Berufsschultag**. Ein solcher Tag
    je Woche muss frei von Arbeit sein: Hat jeder lange Schultag der Woche einen Dienst, steht ein Hinweis am ersten davon;
    ist einer frei, darf an den anderen nach der Schule gearbeitet werden. Beginnt der Unterricht **vor 9:00**, darf vorher
    nicht gearbeitet werden: Dienst vor dem Unterricht gibt einen Hinweis. Beginnt er um 9:00 oder später, ist Arbeit davor
    erlaubt.
- **Nicht geprüft** werden: die Lage der Pausen (§ 11 Abs. 2: frühestens eine Stunde nach Beginn, spätestens eine Stunde
  vor Ende), die Schichtzeit von höchstens 10 Std. einschließlich der Pausen (§ 12, z. B. geteilter Dienst 7–11 und
  15–19 Uhr), Blockunterricht (§ 9 Abs. 1 Nr. 3) und die engeren Grenzen für Kinder unter 15 und für Vollzeitschulpflichtige,
  etwa im Schülerpraktikum (§§ 5, 7: höchstens 7 Std. am Tag und 35 Std. in der Woche) – die App rechnet für alle unter 18
  mit 8/40 Std. Die Bescheinigungen der Untersuchungen prüft sie nicht auf ihr Datum (§ 32: höchstens 14 Monate vor
  Beginn; § 33: höchstens drei Monate alt).
- **Mindesturlaub (§ 19):** Unter „Urlaub & Zeiten“ → Urlaubsanspruch steht neben dem gesetzlichen Mindesturlaub „für
  Jugendliche mindestens ‹n› Tage“ (nur wer das Geburtsjahr sehen darf). Maßgeblich ist das Alter **am 1. Januar** des
  Jahres: unter 16 → 30, unter 17 → 27, unter 18 → 25 Werktage bei einer 6-Tage-Woche, umgerechnet mit **Werktage ×
  Arbeitstage pro Woche ÷ 6**, aufgerundet auf halbe Tage (5-Tage-Woche: 25, 22,5, 21). Mit dem Geburtsjahr allein gilt
  das Alter Jahr − Geburtsjahr − 1 (wer am 1. Januar geboren ist, wäre ein Jahr älter); im Jahr des 18. Geburtstags gibt es
  dann keinen Hinweis. Die Arbeitstage und die Zwölftel bei Eintritt oder Austritt im Jahr wie beim gesetzlichen
  Mindesturlaub (§ 19 Abs. 4 verweist auf das BUrlG). Liegt der Anspruch darunter, erscheint gelb „Unter dem Mindesturlaub
  für Jugendliche (§ 19 JArbSchG): ‹n› Tage“ (statt des allgemeinen Hinweises).
- **Untersuchungen (§§ 32, 33):** zwei vorgegebene Pflichttermine, **„Erstuntersuchung (§ 32 JArbSchG)“** (fällig bis zum
  Beginn der Beschäftigung) und **„Nachuntersuchung (§ 33 JArbSchG)“** (fällig ein Jahr danach). Beginn ist „beschäftigt
  seit“ (Vertragsangaben), sonst der erste Wochenstunden-Eintrag. Sie gelten nur, wenn die Person an diesem Tag unter 18
  ist und es heute noch ist (wer 18 wird, bevor das Jahr um ist, braucht keine Nachuntersuchung; nach dem 18. Geburtstag
  ist nichts mehr nachzuholen). Dann stehen sie beim Mitarbeiter unter „Pflichttermine“ und in der Spalte
  „Pflichttermine“ der Mitarbeiterliste wie die anderen Arten: die Erstuntersuchung „bald fällig“ zwei Monate vorher, die
  Nachuntersuchung **neun Monate nach Beginn** (dann soll der Arbeitgeber an sie erinnern, § 33 Abs. 1), „überfällig“ ab
  dem Fälligkeitstag; die Erstuntersuchung zeigt die Liste schon vor dem ersten Arbeitstag. Ein Eintrag erledigt die Art
  und bleibt sichtbar, auch nach dem 18. Geburtstag. In den Einstellungen lassen sich beide umbenennen, aber nicht löschen;
  eine Wiederholung gibt es nicht (das Gesetz legt die Fälligkeit fest). Ältere Datenbanken bekommen sie mit der
  Migration 0095 hinter den vorhandenen Arten jeder Einrichtung. **Nach dem Update** steht deshalb bei allen, die jetzt
  unter 18 sind, die Erstuntersuchung als überfällig, bis die vorhandene Bescheinigung eingetragen ist (Datum der
  Untersuchung unter „Pflichttermine“ → Eintragen).
- **Beschäftigungsverbot nach 14 Monaten (§ 33 Abs. 3):** Sind 14 Monate seit dem Beginn vergangen (Beginn 01.09.2025 →
  ab 01.11.2026), ist die Person noch unter 18 und ist keine Nachuntersuchung eingetragen, darf sie nicht
  weiterbeschäftigt werden. Dann steht beim Mitarbeiter über den Pflichtterminen rot **„Beschäftigungsverbot:
  Bescheinigung der Nachuntersuchung fehlt (§ 33 Abs. 3 JArbSchG)“** mit dem Datum, und im Dienstplan bekommt jeder Tag
  ab diesem Datum, an dem die Person Arbeit geplant hat, den Hinweis „‹Name›: Beschäftigungsverbot – Bescheinigung der
  Nachuntersuchung fehlt (§ 33 Abs. 3 JArbSchG)“ (wie die anderen Jugendarbeitsschutz-Hinweise,
  „Zur Kenntnis genommen“ möglich). Ein Eintrag der Nachuntersuchung beendet den Hinweis. Grenze: Das Gesetz zählt ab
  der **ersten Beschäftigung überhaupt** (auch bei einem früheren Arbeitgeber; nach § 36 legt die Person dann die
  vorhandenen Bescheinigungen vor) – die App zählt ab „beschäftigt seit“ bzw. dem ersten Wochenstunden-Eintrag. Trage
  bei einem Wechsel von einem anderen Arbeitgeber deshalb die vorhandene Nachuntersuchung ein. Die 14 Monate enden
  nach § 188 Abs. 2/3 BGB mit dem Tag vor dem gleichen Monatstag; gibt es den nicht, mit dem Monatsletzten (Beginn
  31.12.2025 → Verbot ab 01.03.2027). Ein Eintrag der Nachuntersuchung zählt auch, wenn er aus einer früheren
  Einrichtung der Person stammt. Stand der Regel: 19.11.2026 (JArbSchG, zuletzt geändert 23.10.2024).
- **Wer den Hinweis im Dienstplan sieht:** alle, die den Dienstplan bearbeiten dürfen – wie die anderen
  Jugendarbeitsschutz-Hinweise, auch ohne das Recht, die Pflichttermine zu sehen. Bewusst so: Das Alter gilt hier nicht
  als besonders schützenswert, und wer plant, muss wissen, dass die Person nicht eingeplant werden darf. Der Hinweis
  verrät damit, dass die Nachuntersuchung fehlt (kein Befund, keine Gesundheitsangabe).

## 21. Menü

- **Einrichtung wechseln (Träger):** Nach dem Wechsel bleibt die App auf derselben Seite, jetzt für die neue Einrichtung.
  Warst du auf einer einzelnen Person, einem Kind, einer Kasse, einer Teamsitzung oder einer Gruppe, landest du auf der
  Liste dieses Bereichs (die gibt es in der anderen Einrichtung nicht).
- **Einstellungen einer anderen Einrichtung (Träger):** Oben in den *Einstellungen* wählst du bei **„Einstellungen für“**
  eine andere Einrichtung, ohne oben in der App zu wechseln. Alle Bereiche der Einstellungen (Öffnungszeiten, Gruppen,
  Dienste, Tablet, Kinder, Erinnerungen, Personal …) zeigen und ändern dann diese Einrichtung; ein gelber Hinweis sagt,
  welche, und dass oben die bisherige Einrichtung eingestellt bleibt. Die Auswahl gilt, solange du in den Einstellungen
  bleibst; verlässt du sie (oder lädst die Seite neu), gilt wieder die oben eingestellte Einrichtung. Bleibst du nach der
  Frage zu ungespeicherten Änderungen auf der Seite, bleibt auch die Auswahl. Was für alle Einrichtungen gilt (Liste der
  Einrichtungen, Codes, Urlaubsanträge an/aus, Löschfrist, Datensicherung), bleibt davon unberührt. In „Was noch fehlt“ sind Einträge, die zu Seiten außerhalb der Einstellungen führen
  (z. B. eine Person oder ein Kind), dann kein Link: Wechsle dafür oben die Einrichtung. Ungespeicherte Änderungen fragt
  die App vor dem Wechsel ab; auf der Seite einer Gruppe geht es zurück zur Gruppenliste. Die Leitung hat diese Auswahl
  nicht.
- **Leitung und Träger** sehen oben immer: **Dienstplan**, **Urlaubsplanung** (nur wer dafür zuständig ist, mit der Zahl
  offener Anträge), **Zeiterfassung**, **Mitarbeiter**, **Kinder**, **Kasse**, **Kalender** (Jahreskalender) und **Teamsitzungen**. Seltener Gebrauchtes liegt
  unter **Mehr**: Schließzeiten, Krankheitstage, Dokumente (Bögen und Vorlagen), Benutzer, Einstellungen und Passwort ändern (der
  Träger dazu **Rechte und Rollen** und Löschfristen).
  Wer als Leitung oder Träger auch einen eigenen Mitarbeiter-Eintrag hat, findet unter **Meins** „Mein Dienstplan“,
  „Mein Urlaub“, „Meine Termine“ und „Meine Gespräche“; die Zahl ungelesener Änderungen steht an **Meins** und an „Mein Dienstplan“. „Mehr“ und „Meins“ sind
  hervorgehoben, wenn man gerade auf einer ihrer Seiten ist. Der eigene Benutzername steht auf breiten Bildschirmen
  rechts; auf kleineren Laptops ist **Abmelden** nur ein Symbol, der Name erscheint beim Zeigen darauf.
- **Mitarbeiter** sehen oben **Mein Dienstplan** (mit der Zahl ungelesener Änderungen), **Dienstplan**, **Kalender** und
  **Teamsitzungen**; unter **Meins** liegen „Mein Urlaub“, „Meine Termine“, „Meine Gespräche“ und „Dokumente“ (die Vorlagen, nur lesen,
  siehe Abschnitt 19).
- **Auf dem Handy** ist die Kopfzeile nur eine Zeile: Name der App, Einrichtung und der Knopf **Menü** (mit der Zahl
  ungelesener Änderungen bzw. offener Anträge). Er öffnet eine Leiste mit allen Einträgen, gruppiert wie oben, dazu
  Benutzername, **Passwort ändern** und **Abmelden**. Ein Tipp auf einen Eintrag öffnet die Seite und schließt die Leiste.
- **Am Tablet** stehen **Stempeln**, **Dienstplan** und **Teamsitzungen**.

## 22. Zeiterfassung und Mein Dienstplan am Handy

- Auf schmalen Bildschirmen zeigen **Zeiterfassung** (Leitung/Träger) und **Mein Dienstplan** statt der breiten Tabelle eine
  **Karte je Tag**; am Computer bleibt die Tabelle.
- **Zeiterfassung:** oben in der Karte Datum, geplanter Dienst und rechts die Abweichung (orange bei größerer Abweichung).
  Darunter die gestempelten Zeiten zum Antippen und Ändern (zu spät rot, früher gegangen blau), „Zeitraum hinzufügen“ und
  der Mülleimer, dann Hinweise, Krankmeldung und Protokoll, ganz unten **Abwesenheit** und das Feld **Begründung**.
- **Mein Dienstplan:** Datum (mit Feiertag/Schließtag), die Dienste, die gestempelten Zeiten mit „Erfasst“, Info 1/Info 2
  und die Ereignisse; geänderte Tage behalten den orangen Rand.
- **Freie Tage** (Wochenende, Urlaub, Tage ohne Dienst) ohne Stempelzeit, Hinweis oder Begründung sind nur eine schmale
  graue Zeile. In der Zeiterfassung kann man dort mit „+“ trotzdem eine Zeit eintragen und über den Pfeil eine Abwesenheit
  setzen.

## 23. Was noch fehlt

- Ganz oben auf **Einstellungen** zeigt die Karte **Was noch fehlt** (nur Leitung und Träger), was in der gewählten
  Einrichtung noch nicht eingetragen ist, sortiert nach **Einrichtung**, **Mitarbeiter** und **Kinder**: z. B. fehlende
  Öffnungszeiten, kein Tablet-Konto, Gruppen ohne Gruppenart (nur wenn das Bundesland Gruppenarten kennt), Mitarbeiter
  ohne PIN (nur mit Zeiterfassung), PINs, die erst entsperrt werden müssen, ohne Qualifikation, ohne Geburtstag oder ohne
  Zugang, Kinder mit Vertrag ohne Betreuungsart und Gruppen ohne Erinnerung an die Entwicklungsdoku. Die Höchstzahl Kinder der Einrichtung
  sieht nur der Träger, weil nur er sie einträgt. „PIN fehlt“ und „PIN gesperrt“ sehen nur Leitung und Träger (nur sie
  setzen PINs), nicht ein Mitarbeiter, dem der Träger „Einstellungen der Einrichtung“ gegeben hat.
- Bei jedem Punkt stehen bis zu fünf Namen; ein Tipp auf den Punkt oder einen Namen führt dorthin, wo man es einträgt.
  Ist es eingetragen, verschwindet der Punkt von selbst. Ist alles da, steht dort nur „Alles eingetragen.“
- **Brauchen wir nicht** blendet einen Punkt für alle Leitungen und den Träger dieser Einrichtung aus. Ausgeblendete Punkte
  zählen nicht und stehen zugeklappt unten unter **Ausgeblendet (n)**; dort holt **Wieder einblenden** sie zurück.
- Im **Dienstplan** steht für Leitung und Träger eine kleine Zeile „Noch n Punkte offen“ mit Link zu den Einstellungen,
  solange etwas offen ist.

## 24. Kasse

- **Wer:** nur **Leitung** (eigene Einrichtung) und **Träger** (die gewählte Einrichtung), über den Menüpunkt **Kasse**.
  Mitarbeiter und das Tablet sehen die Kassen nicht.
- **Übersicht:** alle Kassen der Einrichtung, geordnet nach **Einrichtung** und den Gruppen. Je Kasse die Art (**Bar** oder
  **EC/Konto**), der **Bestand heute**, „abgeschlossen bis …“ und der Hinweis **Belege fehlen**, wenn in noch offenen
  Monaten Ausgaben ohne Beleg stehen. **Kasse anlegen**: Name, Art, Zuordnung (Einrichtung oder Gruppe), Startmonat und
  Anfangsbestand. Über den Stift kannst du eine Kasse ändern, **archivieren** oder – solange sie keine Einträge hat –
  löschen. Startmonat und Anfangsbestand sind fest, sobald der Startmonat abgeschlossen ist. **Reihenfolge ändern** zeigt
  Pfeile, mit denen du die Kassen innerhalb der Einrichtung bzw. einer Gruppe nach oben oder unten schiebst.
- **Archiv:** archivierte Kassen stehen eingeklappt unten im Bereich **Archiv**. Sie bleiben lesbar und druckbar, neue
  Buchungen gehen nicht mehr; **Wieder aktivieren** (über den Stift) holt sie zurück. Je archivierter Kasse steht
  **löschbar ab …**: der 1. Januar nach Ablauf der **Aufbewahrungsfrist Kasse** (*Einstellungen → Personal →
  Löschfristen*, voreingestellt 10 Jahre), gerechnet ab dem Ende des Jahres der letzten Buchung (letzte Buchung am
  10.03.2026 → löschbar ab 01.01.2037). Steht im Protokoll eine spätere Korrektur (z. B. 2027 eine Buchung von 2026
  geändert), zählt deren Tag. Hat die Kasse keine Buchungen mehr, aber ein Protokoll (z. B. gelöschte
  Einträge) oder abgeschlossene Monate, zählt der letzte Protokolleintrag bzw. das Ende des letzten abgeschlossenen
  Monats. Ab diesem Tag darf die Kasse gelöscht werden – das macht nur der **Träger** unter **Mehr → Löschfristen**
  (siehe Abschnitt 15, „Löschfristen“): Er tippt zur Bestätigung den Namen der Kasse ein; gelöscht werden die Kasse,
  alle Buchungen, Belege, abgeschlossenen Monate und das Protokoll. Umbuchungen mit
  anderen Kassen bleiben dort stehen, mit ihrem Text, auch in abgeschlossenen Monaten; in deren Protokoll steht „Andere
  Kasse gelöscht“. Sie sind danach eine normale Buchung: Eine Ausgabe ohne Beleg in einem noch offenen Monat zählt dann
  bei **Belege fehlen** mit. Eine archivierte Kasse ganz ohne Buchungen und Protokoll lässt sich sofort löschen (wie
  oben). Die App löscht Kassen nie von selbst.
- **Monatsblatt:** ein Tipp auf den Namen öffnet den laufenden Monat; mit den Pfeilen geht es zurück bis zum Startmonat.
  Oben stehen wie im bisherigen Kassenblatt Anfangsbestand, Einnahmen, Ausgaben und aktueller Kassenbestand; der
  Anfangsbestand ist immer der Endbestand des Vormonats. Darunter die Einträge nach Datum, die Nummern getrennt für
  Einnahmen und Ausgaben (nach dem Löschen rücken die übrigen nach). Am Handy steht jeder Eintrag als Karte da.
- **Einnahme / Ausgabe:** Datum (im gezeigten Monat, nicht in der Zukunft), Betrag mit Komma oder Punkt (z. B. 12,50) und
  Verwendungszweck; beim Tippen schlägt die App frühere Texte vor. **Beleg** freiwillig: **Foto aufnehmen** (Handy) oder
  **Datei wählen** (JPG, PNG oder PDF, höchstens 30 MB). „Beleg ansehen“ öffnet ihn in einem neuen Fenster.
- **Umbuchen:** von dieser Kasse an eine andere aktive Kasse der Einrichtung. Die App trägt die Ausgabe hier und die
  Einnahme dort ein; Ändern und Löschen gilt immer für beide.
- **Kassenbestand negativ:** rutscht eine **Barkasse** an einem Tag unter 0 €, erscheint ein roter Hinweis und die
  betroffenen Einträge sind rot. Speichern geht trotzdem. Bei EC/Konto gibt es diesen Hinweis nicht.
- **Monat abschließen:** geht, wenn der Monat vorbei ist (oder ab seinem letzten Tag) und der Vormonat schon
  abgeschlossen ist; warum es noch nicht geht, steht unter dem Knopf. Danach ist der Monat gesperrt. **Wieder öffnen**
  können Leitung und Träger (Schalter „Monate abschließen und wieder öffnen“), mit Begründung; dabei öffnen sich auch alle späteren abgeschlossenen Monate.
- **Protokoll:** unten aufklappbar; jede Änderung mit Name und Zeitpunkt, auch Abschluss und Wieder-Öffnen. Niemand kann
  es ändern.
- **Drucken** zeigt das Blatt im Aufbau der Vorlage (A4 hoch) mit „Gedruckt am … von …“ und dem Abschluss; dort gibt es
  auch **PDF herunterladen**. **Excel-Datei (Monat)** und **Excel-Datei (Jahr)** laden eine Datei, die Excel direkt öffnet.
- Kassen, Einträge und Belege sind in der normalen Datensicherung enthalten.

## 25. Bögen, Mitarbeitergespräche, Beobachtungsbögen und Teamsitzungen

- **Vorlagen:** im Menü unter **Mehr → Dokumente**, Reiter **Bögen** (Leitung und Träger). Die Seite zeigt die Vorlagen in Kästen:
  **Kinder** (Beobachtungen, Entwicklungsgespräche), **Fachkräfte** (Mitarbeitergespräche), **Team** (Teamsitzungen) und
  **Unfälle**, jeder mit eigenem „Vorlage anlegen“; auf großen Bildschirmen stehen die Kästen nebeneinander. Mit dem **Drucker-Zeichen** bei einer Vorlage druckst du
  sie **leer** (A4 hochkant) – zum Ausfüllen von Hand, mit leeren Kopffeldern, Kästchen, Schreiblinien und Unterschriftszeilen. Die Einrichtungen von vor dem Update haben die Startvorlagen **Selbstbeurteilung** und **Beurteilungsbogen pädagogische
  Fachkräfte**. Du kannst Vorlagen anlegen, **kopieren**, **stilllegen** (steht dann eingeklappt unten, schon angelegte
  Bögen bleiben lesbar) und löschen – Löschen geht nur, solange noch kein Bogen damit angelegt wurde.
- **Reihenfolge:** Mit den Pfeilen **Nach oben / Nach unten** rechts bei jeder aktiven Vorlage schiebst du sie innerhalb
  ihres Kastens (bei **Unfälle** stehen die Vorlagen für Kinder und für Mitarbeiter zusammen in einem Kasten). In dieser
  Reihenfolge bietet die App die Vorlagen überall zur Auswahl an: beim Anlegen eines Bogens in der Kinderakte, beim
  Mitarbeitergespräch, bei der Teamsitzung und beim Unfallbericht bzw. der Unfallanzeige. Neue und kopierte Vorlagen
  kommen ans Ende. Stillgelegte Vorlagen haben keine Pfeile; sie behalten ihren Platz und stehen nach dem
  **Wieder aktivieren** wieder dort, wo sie vorher waren.
- **Neue Einrichtungen** (unter Einstellungen neu angelegt, seit dem Update mit „Dokumente“) bekommen nur die
  Startvorlagen für Unfälle (**Unfallbericht Kind** und **Unfallanzeige (U 1000)**). Selbstbeurteilung,
  Beurteilungsbogen, Entwicklungsgespräch und Teamsitzung legt die App dort nicht an – auch später nicht. Ein Kasten
  ohne Vorlage zeigt einen Hinweis: Namen eintragen und auf **Vorlage anlegen** tippen. Bestehende Einrichtungen
  behalten alle ihre Vorlagen.
- **Vorlage bearbeiten:** Name, bei Mitarbeitergesprächen „Vom Mitarbeiter auszufüllen“, dann **Bereiche** (Titel,
  Hinweistext) und darin **Punkte**: Hinweis, Freitext, Ankreuzliste (mit Möglichkeiten), Bewertung (+ / ~ / −),
  Meilenstein (mit Altersstufe) und Datum. Mit den Pfeilen verschiebst du Bereiche und Punkte (Punkte auch in den
  nächsten Bereich). Die Art eines Punkts lässt sich nicht ändern – lösch ihn und leg ihn neu an. Erst **Vorlage
  speichern** übernimmt alles. Änderungen gelten nur für neue Bögen; schon angelegte Bögen behalten ihren Inhalt.
- **Gespräch anlegen:** Mitarbeiter → Person → Reiter **Gespräche** → **Gespräch anlegen**: Datum, Uhrzeit, Teilnehmer,
  Zeitraum und die Bögen (vorgeschlagen: Selbstbeurteilung und Beurteilungsbogen). **Öffnen** zeigt den Bogen zum
  Ausfüllen; **Speichern** nicht vergessen (ein Hinweis zeigt ungespeicherte Änderungen).
- **Eigene Gespräche:** Niemand führt ein Gespräch über sich selbst. Ist dein Konto mit einem Mitarbeiter verknüpft,
  fehlt auf deiner eigenen Seite der Reiter „Gespräche“ – deine Gespräche führt der Träger bzw. eine andere Leitung. Du
  siehst sie wie alle Mitarbeiter unter **Meins → Meine Gespräche**, sobald sie für dich freigegeben sind.
- **Selbstbeurteilung:** **Zum Ausfüllen freigeben** – dann sieht der Mitarbeiter den Bogen mit seinem eigenen Zugang
  unter **Meine Gespräche** (nicht am Tablet), kann zwischendurch speichern und am Ende **Abgeben**. Danach kann er nichts
  mehr ändern. Solange nicht abgegeben ist, kannst du die **Freigabe zurücknehmen**; eine Abgabe kannst du **wieder
  öffnen**.
- **Beurteilung:** füllt nur die Leitung bzw. der Träger aus. **Zum Lesen freigeben** zeigt sie dem Mitarbeiter unter
  „Meine Gespräche“ nur zum Lesen; **Lesefreigabe zurücknehmen** nimmt das zurück.
- Unter jedem Bogen steht „zuletzt geändert von … am …“ und, wenn es zutrifft, „freigegeben am …“, „abgegeben am …“ oder
  „zum Lesen freigegeben am …“. Hat jemand anderes den Bogen inzwischen gespeichert, sagt die App das beim Speichern;
  **Neu laden** holt den aktuellen Stand.
- **Drucken:** jeder Bogen hat eine Druckseite (A4 hoch) mit Kopffeldern, Bewertungstabelle, Ankreuzkästchen, leeren
  Schreiblinien und den beiden Unterschriftszeilen; dort gibt es auch **PDF herunterladen**. Mitarbeiter drucken ihre
  freigegebenen Bögen über „Meine Gespräche“.

### Formatierung in Freitexten (alle Bögen)

- Jedes **Freitext**-Feld in allen Bögen (Mitarbeitergespräche, Beobachtungen und Entwicklungsgespräche, Teamsitzungen,
  Unfallberichte und Unfallanzeigen, auch am Tablet) hat oben eine kleine Leiste: **Fett**, **Kursiv**,
  **Unterstrichen**, **Aufzählung**, **nummerierte Liste**, **Rückgängig** und **Wiederholen**. Tastenkürzel: Strg+B,
  Strg+I, Strg+U (Strg+Z / Strg+Y). „- “ bzw. „1. “ am Anfang einer Zeile beginnt eine Aufzählung bzw. eine nummerierte
  Liste; zweimal Enter beendet die Liste. „3. “ beginnt die Nummerierung bei 3 (bis 999). Auf Handy und Tablet bricht
  die Leiste um, die Knöpfe sind fingergroß.
- **Einfügen** aus Word, E-Mails oder Webseiten behält nur diese Formatierungen; Überschriften, Farben, Schriftgrößen,
  Links und Bilder fallen weg (der Text bleibt).
- **Höchstens 4000 Zeichen** je Freitext wie bisher (Zeilen- und Absatzwechsel zählen je ein Zeichen; mit sehr viel
  Formatierung etwas weniger). Kurz vor der Grenze zeigt das Feld „… von 4000 Zeichen“, darüber eine rote Meldung – so
  lässt sich der Bogen nicht speichern. Alle formatierten Freitexte eines Bogens zusammen dürfen beim Speichern höchstens
  200 000 Zeichen HTML haben (praktisch nie erreicht; schützt den Server vor riesigen Anfragen).
- **Alte Antworten** (vor diesem Update geschrieben) bleiben, wie sie sind, und werden wie bisher mit ihren
  Zeilenumbrüchen angezeigt und gedruckt. Erst wenn du eine solche Antwort änderst, wird sie im neuen Format gespeichert.
  Nur Hineinklicken ohne Änderung zählt nicht als Änderung.
- **Drucken:** Formatierungen und Listen erscheinen auch im Ausdruck und im PDF. In der **Unfallanzeige (U 1000)** mit
  ihren festen Kästchen bleiben Fett/Kursiv/Unterstrichen, Absätze und Listenpunkte stehen dort als einzelne Zeilen mit
  „•“ bzw. „1.“ davor.
- **Technik (für den Betrieb):** Formatierte Antworten werden als kleines HTML gespeichert (nur Absätze, Zeilenumbrüche,
  fett, kursiv, unterstrichen, Aufzählungen und nummerierte Listen). Der Server bereinigt jede Antwort bei jedem
  Speichern: alle Attribute (außer der Startnummer `start` einer nummerierten Liste, 1–999), Skripte, Styles,
  Kommentare und alle anderen Tags fallen weg (deren Text bleibt). Eine gespeicherte Antwort gilt als formatiert, wenn
  sie mit `<p>`, `<ul>` oder `<ol>` (auch `<ol start="…">`) beginnt; alles andere ist alter
  Klartext und wird nie als HTML gelesen. Beim Anzeigen wird noch einmal bereinigt. Keine Datenbank-Migration; die
  Datensicherung enthält die Antworten wie bisher.

### Beobachtungsbögen

- **Wo:** Kinderakte → Bereich **Beobachtungen** (im Büro und am aufgeschlossenen Tablet, nie auf den Handys der
  Mitarbeiter). Die Liste zeigt die Bögen des Kindes, neueste zuerst, mit Datum, Vorlage und „zuletzt geändert“.
  Die Einrichtungen von vor dem Update haben die Startvorlage **Entwicklungsgespräch** (Mehr → Dokumente → Bögen, Kasten „Kinder“).
- **Anlegen:** **Bogen anlegen** – Vorlage, Datum, Uhrzeit (freiwillig) und Teilnehmer. Beim Elterngespräch gibt es
  **Bogen ausfüllen**: Datum, Uhrzeit und Teilnehmer kommen aus dem Gespräch, danach steht dort **Bogen öffnen**. Ein
  Elterngespräch hat höchstens einen Bogen; wird das Gespräch gelöscht, bleibt der Bogen.
- **Wer darf was:** Lesen kann jeder, der die Akte sieht. **Anlegen und ändern** können
  - Leitung und Träger bei jedem Kind;
  - die **Mitarbeitenden der Gruppe des Kindes** (Schalter „Bögen: eigene Gruppe anlegen und ausfüllen (auch
    Entwicklungsgespräche)“, in der Grundeinstellung bei Mitarbeiter, Gruppenleitung und Leitung an): alle Bögen eines
    Kindes ihrer Gruppe, auch den Bogen zu einem Elterngespräch – am Tablet nach dem Aufschließen und, wer „Kinder: auch
    mit eigenem Zugang“ hat (z. B. die Gruppenleitung), auch im Büro. „Eigene Gruppe“ heißt hier nur die
    **Stammgruppe** der Person (beim Mitarbeiter eingetragen). Wer keine Stammgruppe hat, Aushilfen aus anderen
    Einrichtungen und Gruppen, die die Person nur lesen darf, zählen nicht; ein weiterer Umfang bei „Anwesenheit und
    Gruppenbuch“ auch nicht. Bei einem Kind ohne Gruppe ändern nur Leitung, Träger, Bezugserzieher und Freigeschaltete.
    Maßgeblich ist die Gruppe des Kindes am heutigen Tag (ein fälliger Gruppenwechsel zählt sofort);
  - am Tablet der **Bezugserzieher** des Kindes, auch in einer anderen Gruppe.

  Mitarbeitende anderer Gruppen sehen den Bogen nur zum Lesen, bis Leitung oder Träger sie über **Mitarbeiter
  freischalten** für genau diesen Bogen freischalten (zurücknehmbar, gilt am Tablet). Wechselt der Bezugserzieher, wechselt
  das Recht sofort mit. Schaltet der Träger den Schalter für eine Rolle aus, gilt für sie wieder nur Bezugserzieher und
  Freischaltung. **Löschen** (mit Rückfrage) und **Mitarbeiter freischalten** können nur Leitung und Träger. Im Archiv
  wird nichts mehr geändert.
- **Speichern:** Kopffelder und Antworten werden zusammen mit **Speichern** übernommen. Mit ungespeicherten Änderungen
  fragt die App, bevor der Bogen geschlossen oder die Akte verlassen wird; am Tablet fragt **Sperren** ebenfalls, und
  kurz bevor sich das Tablet von selbst sperrt, erscheint ein Hinweis – tippen und speichern, sonst gehen die
  Änderungen beim Sperren verloren.
- **Drucken:** im Büro über **Drucken** am Bogen (A4 hoch, mit PDF): Name, Geburtsdatum, Gruppe, Datum, Uhrzeit,
  Teilnehmer, die Meilensteine als Tabelle nach Altersstufe (3;0 / 4;0 / 5;0 / 6;0 Jahre) und die Unterschriftszeilen
  „Unterschrift Fachkraft / Datum“ und „Unterschrift Erziehungsberechtigte / Datum“. Am Tablet wird nicht gedruckt.
- **Abmeldung:** die Bögen bleiben im Archiv für Leitung und Träger lesbar und werden mit der Akte gelöscht.

### Teamsitzungen

- **Wo:** Menüpunkt **Teamsitzungen** – bei Leitung und Träger oben im Menü neben „Kalender“, bei den Mitarbeitern oben im Menü und am
  Tablet neben „Stempeln“ und „Dienstplan“ (ohne Aufschließen, es gibt dort keine Kinderdaten). Die Liste zeigt die
  Sitzungen eines Jahres, neueste zuerst; mit **Gruppe** filterst du nach „Alle“, „Einrichtung“ (Sitzungen der ganzen
  Einrichtung) oder einer Gruppe.
- **Anlegen:** **Sitzung anlegen** – Vorlage (Startvorlage **Teamsitzung** in den Einrichtungen von vor dem Update, eigene unter Mehr → Dokumente → Bögen, Kasten
  „Team“), Datum, Uhrzeit (freiwillig), Gruppe oder ganze Einrichtung, Teilnehmer und Protokollführung. Das kann
  jeder in der Einrichtung: Leitung, Träger, Mitarbeiter und das Tablet.
- **Mitschreiben:** Solange die Sitzung ein **Entwurf** ist, können alle Kopffelder und Protokoll ändern; **Speichern**
  nicht vergessen. Darunter steht „zuletzt geändert von … am …“ (am Tablet „Tablet“). Hat jemand anderes inzwischen
  gespeichert, sagt die App das; **Neu laden** holt den aktuellen Stand.
- **Freigeben:** Leitung oder Träger tippen auf **Freigeben** (Rückfrage, ungespeicherte Änderungen werden vorher
  gespeichert). Danach ist das Protokoll für alle nur noch zu lesen, mit „freigegeben am … von …“. Hat jemand gerade noch
  geschrieben, wird sein letztes Speichern abgelehnt; sein Text bleibt zum Lesen (und Abschreiben) stehen, **Neu laden**
  zeigt das freigegebene Protokoll.
- **Wieder öffnen:** nur Leitung und Träger, mit einer **Begründung** (1 bis 200 Zeichen). Die letzte Begründung steht
  danach am Protokoll („zuletzt wieder geöffnet am … von …“); alle können wieder mitschreiben.
- **Löschen:** nur Leitung und Träger, mit Rückfrage.
- **Drucken:** **Drucken** an der Sitzung (A4 hoch, mit PDF) zeigt Einrichtung, Gruppe, Datum, Uhrzeit, Teilnehmer,
  Protokollführung, das Protokoll und am Ende „freigegeben am … von …“ bzw. „Entwurf – noch nicht freigegeben“. Am
  Tablet wird nicht gedruckt.

## 26. Rechte und Rollen

### Die Seite „Rechte und Rollen“ (nur Träger)

- Unter **Mehr → Rechte und Rollen** (oder auf *Benutzer* über „Rechte und Rollen einstellen“) stellst du ein, was
  **Leitung**, **Gruppenleitung** und **Mitarbeiter** dürfen. Die Seite zeigt keine Einzelrechte, sondern **Schalter**, geordnet nach
  Bereichen (Dienstplan, Urlaub, Zeiten, Mitarbeiter, Personalakte, Kinder, Bögen, Teamsitzungen, Notizen, Kontakte,
  Kasse, Kalender, Vorlagen, Verwaltung). Je Rolle gibt es eine Spalte mit einem Häkchen.
- Bei den Kinder-Schaltern „ansehen“, „Anwesenheit und Gruppenbuch“ und „eintragen und Akten ändern“ wählst du neben dem
  Häkchen den **Umfang**: „eigene Gruppe“ (wie bisher bei Mitarbeitern: nur die Stammgruppe; wer keine Gruppe hat, alle
  Gruppen) oder „ganze Einrichtung“. Was „ansehen“ erreicht, begrenzt die anderen beiden: Stellst du „Anwesenheit“ oder
  „eintragen“ auf „ganze Einrichtung“, geht „ansehen“ mit; stellst du „ansehen“ auf „eigene Gruppe“, gehen die anderen
  mit. Ein Hinweis sagt, was mitgeändert wurde. Bei den Ausnahmen einer Person geht „ansehen“ beim Erweitern ebenso mit.
- **Abhängigkeiten:** Unter einem Schalter steht grau „braucht: …“ bzw. „enthalten in: …“. Setzt du ein Häkchen, kommt
  alles mit, was der Schalter braucht; ein Hinweis sagt, was mit freigegeben wurde. Nimmst du ein Häkchen weg, von dem
  andere abhängen, fragt die App „Dann entfällt auch: …“.
- Ein Schalter, den ein anderer enthält (z. B. „Dienstplan: bearbeiten“ in „freigeben“), ist grau angehakt, solange der
  andere an ist; zum Ausschalten erst den anderen wegnehmen.
- Ein Punkt (•) zeigt einen Schalter, der von der Grundeinstellung abweicht. **Speichern** unten speichert alle drei Rollen;
  verlässt du die Seite mit ungespeicherten Änderungen, fragt die App nach. **Verwerfen** holt den gespeicherten Stand
  zurück.
- **„Leitung: Grundeinstellung“**, **„Gruppenleitung: Grundeinstellung“** bzw. **„Mitarbeiter: Grundeinstellung“**
  setzt eine Rolle (nach Rückfrage) auf die Grundeinstellung zurück. Bei Leitung und Mitarbeiter entspricht die
  Grundeinstellung den bisherigen Rechten, bei der Gruppenleitung siehe unten. Ausnahmen einzelner Personen bleiben
  dabei erhalten.
- Ganz unten stehen grau die Rechte, die **nur der Träger** hat (z. B. Rechte einstellen, Träger-Konten, Einrichtungen,
  Löschen nach Fristen, Datensicherung, Personalschlüssel-Werte, Schulkinder-Einstellungen). Sie lassen sich nicht
  vergeben.
- Eine Änderung gilt für alle Konten der Rolle ab ihrer nächsten Aktion; das Menü passt sich nach dem nächsten Laden der
  Seite an.
- Auf dem Handy (und auf einem schmalen Tablet im Hochformat) zeigt die Tabelle eine Rolle auf einmal; oben wählst du
  „Leitung“, „Gruppenleitung“ oder „Mitarbeiter“.
- Die zugeklappte Übersicht **„Rechte der Rollen“** auf *Benutzer* zeigt die tatsächlichen Einstellungen (nur lesen).

### Die Gruppenleitung

- **Gruppenleitung** ist eine eigene Rolle zwischen Leitung und Mitarbeiter. Wie ein Mitarbeiter-Konto ist das Konto
  immer mit einem Mitarbeiter verknüpft und gehört zu dessen Einrichtung.
- **Grundeinstellung:** alles, was ein Mitarbeiter darf, und dazu „Kinder: eintragen und Akten ändern“ (eigene Gruppe)
  und „Kinder: auch mit eigenem Zugang (nicht nur am Tablet)“. Die Gruppenleitung sieht also im Menü **Kinder** und
  pflegt die Kinder ihrer Gruppe auch im Büro, nicht nur am Tablet. Andere Gruppen sieht sie nur, wenn sie für sie
  freigeschaltet sind (nur lesend); hat sie keine Stammgruppe, pflegt sie die Kinder aller Gruppen. Weil sie „Kinder“ mit dem
  eigenen Konto hat, zeigt das Menü die Büro-Anordnung: die eigenen Seiten unter „Meins“, „Dokumente“ unter „Mehr“.
- **Vormerkungen und künftige Vertragskinder** sieht sie auch im Büro nur, wenn die Tablet-Schalter (*Einstellungen →
  Einrichtung → Tablet*) an sind – außer der Träger gibt ihr „Kinder: verwalten“.
- Am **Tablet** gelten nach dem Aufschließen mit Name und PIN die Rechte ihres Gruppenleitungs-Kontos.
- Wird ein Mitarbeiter-Konto zur Gruppenleitung, entfällt seine Ausnahme „eintragen und Akten ändern“ für die eigene
  Gruppe (die Rolle hat es schon); eine Ausnahme für die ganze Einrichtung oder ein „weggenommen“ bleibt.
- Alles andere stellst du als Träger in der Spalte **Gruppenleitung** ein; eine Änderung gilt für alle Gruppenleitungen.
- **Wer was verwaltet:** Gruppenleitungs-Konten legt die Leitung ihrer Einrichtung an, ändert sie, setzt das Passwort
  zurück, deaktiviert sie und setzt die PIN – wie bei Mitarbeitern. Die **Rechte** einer Gruppenleitung (Spalte und
  Ausnahmen je Person) stellt aber **nur der Träger** ein; die Leitung sieht dort nur einen Hinweis. Eine Gruppenleitung
  verwaltet selbst keine Leitungs-, Gruppenleitungs- oder Mitarbeiter-Konten; bekommt sie „Zugänge verwalten“, nur
  Tablet-Konten.

### Geänderte Grundeinstellung

- Die Mitarbeitenden legen **Beobachtungsbögen und Entwicklungsgespräche der Kinder ihrer Gruppe** an und füllen sie aus
  (Schalter „Bögen: eigene Gruppe anlegen und ausfüllen (auch Entwicklungsgespräche)“, an bei Mitarbeiter,
  Gruppenleitung und Leitung; Abschnitt 25). Bestehende Installationen bekommen ihn ohne weiteres Zutun: Gespeichert
  werden nur die Schalter, die von der Grundeinstellung abweichen, also gilt für den neuen Schalter die Grundeinstellung
  („an“), bis der Träger ihn ausschaltet. Der bisherige Schalter heißt jetzt „Bögen: alle anlegen und ausfüllen“.
  Unfallberichte bleiben, wie sie sind: Einen Unfallbericht schreibt, wer die Anwesenheit des Kindes führt (eigene Gruppe).
- Die Leitung darf abgeschlossene **Kassenmonate wieder öffnen** (Schalter „Monate abschließen und wieder öffnen“).
- Ob die Leitung die **Vertragsangaben** sieht, ist jetzt der Schalter „Vertragsangaben ansehen“ der Leitung (der
  frühere Schalter auf der Seite *Mitarbeiter* ist weg; die bisherige Einstellung wurde übernommen).
- Wer **Urlaub plant und genehmigt**, ist der Schalter „Urlaub: planen und genehmigen“ (je Rolle oder als Ausnahme je
  Person). Bisherige Zuständige (Leitung) wurden als Ausnahme übernommen. In *Einstellungen → Urlaub* wählst du nur noch,
  welche Träger-Konten bei neuen Anträgen benachrichtigt werden.

### Ausnahmen je Person

- Bei der Person (*Mitarbeiter → Name → Reiter „Zugang“*, aufklappbar **„Rechte dieser Person“**, oder *Benutzer* →
  „Rechte“) siehst du als Träger jeden Schalter mit dem Stand der Rolle, der Ausnahme und dem, was gilt.
- Je Schalter wählst du **„von der Rolle“** (keine Ausnahme), **„zusätzlich erlaubt“** oder **„weggenommen“**; bei den
  Kinder-Schaltern mit Umfang. Jede Änderung wird sofort gespeichert. Auch hier kommt mit, was ein Schalter braucht, und
  vor dem Wegnehmen fragt die App, was sonst noch entfällt.
- Ändert sich die Rolle einer Person, bleiben ihre Ausnahmen bestehen – außer beim Wechsel zur Gruppenleitung: Dann
  entfällt die Ausnahme „eintragen und Akten ändern“ für die eigene Gruppe (siehe „Die Gruppenleitung“). Träger- und
  Tablet-Konten haben feste Rechte.

### Was die Leitung darf

- Die Leitung sieht bei **Mitarbeitern ihrer Einrichtung** nur den Schalter **„Kinder: eintragen und Akten ändern
  (eigene Gruppe)“** (früher „darf Kinderakten pflegen“) und kann ihn setzen oder wegnehmen. Alle anderen Ausnahmen und
  die Seite *Rechte und Rollen* sind dem Träger vorbehalten. Bei anderen Leitungen sieht sie keine Rechte, bei einer
  **Gruppenleitung** nur den Hinweis „Die Rechte der Gruppenleitung stellt der Träger ein.“
- In zwei Fällen ist das Häkchen grau, mit einem Hinweis: Wegnehmen geht nicht, solange der Träger der Person ein Recht
  gegeben hat, das darauf aufbaut (z. B. „Kinder: verwalten“); Setzen geht erst, wenn die Person „Kinder: ansehen“ hat.
  Beides stellt der Träger ein. In Klammern steht, für welchen Bereich das Recht gilt (eigene Gruppe oder ganze
  Einrichtung).

### Sicherheitsregeln

- **Eigenes Konto:** Den eigenen Zugang, die eigenen Rechte, die eigene Gruppe und die eigenen Stempel-Einstellungen
  („Stempeln über“, Pausen) ändert nur der Träger. Neu: Auch die Leitung kann ihre eigenen Stempel-Einstellungen nicht
  mehr ändern.
- **PINs** setzen, löschen und entsperren nur **Leitung** und **Träger** – auch wer „Mitarbeiter pflegen“ hat, nicht.
  Eine PIN für eine Person mit Träger-Konto setzt nur der Träger.
- **Zugänge verwalten:** Der Träger verwaltet alle Konten. Die Leitung verwaltet Leitungs-, Gruppenleitungs-,
  Mitarbeiter- und Tablet-Konten ihrer Einrichtung (die Rechte einer Gruppenleitung aber nicht). Wer sonst „Zugänge
  verwalten“ bekommt (z. B. eine Gruppenleitung oder ein Mitarbeiter), verwaltet nur Tablet-Konten.
- **Bekannte Grenze:** Eine Leitung kann weiterhin andere Leitungs-Konten ihrer Einrichtung anlegen, ändern und deren
  Passwort zurücksetzen, und sie kann Passwort und PIN von Gruppenleitungen und Mitarbeitern ihrer Einrichtung setzen. Hat der Träger einer
  Leitung Rechte weggenommen, könnte sie so mit einem anderen Konto arbeiten. Gib das Leitungs-Konto deshalb nur
  Personen, denen du die ganze Einrichtung anvertraust.

## 27. Kontakte (Adressbuch der Einrichtung)

Unter **Mehr → Kontakte** führt jede Einrichtung ihr Adressbuch mit wichtigen Kontakten nach außen: Schulen, Jugendamt,
Gesundheitsamt, Fachberatung, Ärztinnen und Ärzte, Handwerk und Notdienst usw.

### Kategorien

- Jede Einrichtung hat **eigene Kategorien**. Zum Start (bestehende Einrichtungen beim Update, neue beim Anlegen) gibt es:
  Schulen, Jugendamt, Gesundheitsamt, Fachberatung, Ärztinnen/Ärzte & Therapie, Träger & Verwaltung, Handwerk & Notdienst,
  Sonstiges.
- **Kategorien verwalten**: hinzufügen, umbenennen, Reihenfolge ändern. Löschen geht nur, solange keine Kontakte der
  Einrichtung darin liegen. Ein Name kommt in einer Einrichtung nur einmal vor (Groß-/Kleinschreibung zählt nicht).
- Die Kategorien erscheinen auf der Seite als Reiter („Alle“, dann die Kategorien, ggf. „Vom Träger“). Das Suchfeld sucht
  in Einrichtung/Firma, Ansprechperson, Funktion, Notiz und Ort.

### Kontakte

- Pro Kontakt: Einrichtung oder Firma (Pflicht), Ansprechperson, Funktion (z. B. Kooperationslehrkraft), Telefon, Mobil,
  E-Mail, Website, Anschrift und eine Notiz (bis 1000 Zeichen). E-Mail und Website werden geprüft; eine Website ohne
  „https://“ bekommt es vorangestellt, andere Adressarten als http/https sind nicht erlaubt.
- Telefon, Mobil, E-Mail und Website sind anklickbar (Anruf, E-Mail-Programm, neue Seite).
- **„auch für Mitarbeitende und am Tablet sichtbar“**: Nur Kontakte mit diesem Haken sehen Mitarbeiter-Konten (unter
  **Meins → Kontakte**, der Eintrag erscheint erst, wenn es mindestens einen solchen Kontakt gibt) und das Tablet (Kachel
  **Kontakte** auf der Startseite, ohne PIN). Ohne Haken sehen ihn auf dieser Seite nur Leitung und Träger (Hinweis
  „nur Leitung“); zur Ausnahme bei Schulen siehe „Künftige Schule eines Kindes“.
- **Drucken**: alle Kontakte oder die geöffnete Kategorie, jeweils so, wie die Person sie sieht (nicht am Tablet).

### Wer was darf

| Wer | Was |
|---|---|
| Träger | alles, in der gewählten Einrichtung; zusätzlich Kontakte **für alle Einrichtungen** |
| Leitung (Recht „Kontakte: pflegen“, voreingestellt an) | alle Kontakte der Einrichtung sehen, anlegen, ändern, löschen; Kategorien verwalten |
| Mitarbeiter, Gruppenleitung, Tablet | nur die freigegebenen Kontakte lesen (Recht „Kontakte lesen“ hat jedes Konto) |

Das Recht „Kontakte: pflegen“ steht auf der Seite **Rechte und Rollen** (Bereich „Kontakte“) und ist für die Leitung
voreingestellt; der Träger kann es auch einer Gruppenleitung oder einzelnen Personen geben. Jede Einrichtung sieht nur ihre
eigenen Kontakte (und die des Trägers für alle Einrichtungen).

### Kontakte für alle Einrichtungen (nur Träger)

Beim Anlegen wählt der Träger „für alle Einrichtungen“ und gibt statt einer Kategorie einen **Kategorie-Namen** ein
(Vorschläge: die Namen, die die Einrichtungen verwenden). In jeder Einrichtung erscheint der Kontakt in der Kategorie mit
diesem Namen, sonst im Reiter **„Vom Träger“**. Ändern und löschen kann ihn nur der Träger; eine Kategorie gleichen Namens
kann die Einrichtung trotzdem löschen (der Kontakt wandert dann zu „Vom Träger“).

### Künftige Schule eines Kindes

- In der Kinderakte (Stammdaten) gibt es das Feld **„künftige Schule“**: Auswahl aus den Kontakten in Kategorien mit
  „Schule“ im Namen (z. B. „Schulen“, „Grundschulen“) der Einrichtung und des Trägers. Am Tablet gilt es wie die übrigen
  Stammdaten (lesen; ändern, wer die Akte ändern darf).
- Name und Ort einer Schule sieht in der Kinderakte (und in der Liste der Schulkinder) jede Person, die die Akte sehen
  bzw. ändern darf – auch ohne den Haken „auch für Mitarbeitende und am Tablet sichtbar“; Ansprechperson, Telefon,
  E-Mail und Notiz nicht.
- Das frühere Freitextfeld heißt jetzt **„Grundschule (Notiz)“**. Es erscheint nur noch, wenn darin schon etwas steht oder
  unter Kontakte noch keine Schule eingetragen ist; für die Liste der Schulkinder zählt nur „künftige Schule“.
- Die Liste **Kinder → Belegung → „Schulkinder zum 1.9.“** zeigt die künftige Schule, lässt sich **nach Schule
  gruppieren** und **nach Schule drucken** (eine Liste pro Schule, z. B. zum Weitergeben an die Schule).
- Wird der Kontakt gelöscht, verliert das Kind die Auswahl (das Feld ist dann leer). Zieht ein Kind in eine andere
  Einrichtung um, bleibt eine Schule des Trägers erhalten, eine Schule der alten Einrichtung wird geleert.

### Datenschutz

Die Kontakte sind **Geschäftskontakte** (Behörden, Schulen, Firmen und deren Ansprechpersonen), keine Daten von Kindern,
Eltern oder Mitarbeitern. Es gibt daher keine eigene Löschfrist: Wer einen Kontakt nicht mehr braucht, löscht ihn. Die
Kontakte einer Einrichtung (und ihre Kategorien) gehören zur Einrichtung und würden mit ihr gelöscht. In den Sicherungen
sind sie wie alle Daten enthalten. Wer einen Kontakt zuletzt geändert hat (Benutzername, Datum), sehen nur Leitung und
Träger, nicht die Mitarbeiter und nicht das Tablet. E-Mail-Adressen dürfen keine Zusätze wie „?bcc=“ enthalten, damit ein
Klick darauf keine weiteren Empfänger einträgt.

## 28. Wissen (Dokumente → Wissen) mit „Gelesen und verstanden“

Unter **Dokumente → Wissen** sammelt jede Einrichtung, was das Team nachlesen soll: Konzepte und Pläne als **PDF**,
**Links** zu offiziellen Seiten (Gesetze, Orientierungsplan, RKI) und **kurze Texte** (mit Fett, Kursiv, Unterstrichen
und Listen wie bei den Freitexten der Bögen). Bei wichtigen Einträgen bestätigt jede Person **„Gelesen und verstanden“**;
Leitung und Träger sehen, wer bestätigt hat und wer noch nicht.

### Kategorien

- Jede Einrichtung hat **eigene Kategorien**, mit **„Wer sieht sie?“** wie bei den Vorlagen: **Alle** (auch Mitarbeiter
  und Tablet), **nur Leitung und Träger** oder **nur Träger**. Mitarbeiter und das Tablet sehen nur die Kategorien für
  **Alle**.
- Zum Start bekommt jede Einrichtung (bestehende beim ersten Start nach dem Update, neue beim Anlegen) die Kategorien
  **Orientierungsplan, Aufsichtspflicht, Kinderschutz, Hygiene & Gesundheit, Gesetze & Vorgaben** mit Links zu
  offiziellen Seiten: Orientierungsplan Baden-Württemberg (Kultusministerium), § 832 BGB (Aufsichtspflicht), § 8a SGB VIII
  (Kinderschutz), § 34 IfSG und der RKI-Ratgeber zur Wiederzulassung, das Kindertagesbetreuungsgesetz Baden-Württemberg
  (KiTaG) sowie § 45 und § 47 SGB VIII. Orientierungsplan und KiTaG bekommen nur Einrichtungen in Baden-Württemberg. Alles
  lässt sich ändern oder löschen; **Gelöschtes kommt nicht wieder** (die App merkt sich je Einrichtung, was sie schon
  bekommen hat). Maßgeblich ist das Bundesland der Einrichtung beim ersten Start bzw. beim Anlegen: Wechselt es später,
  bleiben die Links, wie sie sind (von Hand löschen oder ergänzen). Die Links wurden beim Einbau am 23.11.2026 geprüft; Behörden ändern ihre Adressen manchmal – führt ein
  Link ins Leere, bitte die neue Adresse eintragen.
- **Kategorien verwalten**: anlegen, umbenennen, „Wer sieht sie?“ ändern, mit den Pfeilen verschieben. Löschen geht nur,
  solange keine Einträge der Einrichtung und keine Unterkategorien darin liegen. Ein Name kommt in einer Einrichtung nur
  einmal vor.
- **Unterkategorien** (eine Ebene, wie bei den Vorlagen in Abschnitt 19): Bei jeder Kategorie legt **Unterkategorie
  anlegen** eine Unterkategorie an; sie steht eingerückt unter ihrer Kategorie und lässt sich umbenennen, innerhalb der
  Kategorie verschieben, mit eigenem „Wer sieht sie?“ einstellen (es gilt zusätzlich das der Kategorie – die engere
  Einstellung zählt) und löschen, solange sie leer ist. Unter einer Kategorie kommt jeder Name nur einmal vor; derselbe
  Name darf in einer anderen Kategorie stehen. Auf dem Reiter einer Kategorie mit Unterkategorien gibt es eine zweite Reihe
  kleiner Reiter: **Alle** (die Einträge nach Unterkategorien gruppiert), **Allgemein** (die Einträge direkt in der
  Kategorie, nur wenn es welche gibt) und die Unterkategorien. Das Gerät merkt sich die letzte Wahl je Kategorie. Die
  Suche zeigt bei jedem Treffer „Kategorie › Unterkategorie“, ebenso der gedruckte Nachweis.
- **Gesetze & Vorgaben** bekommt die Unterkategorien **Bund** (§ 45 und § 47 SGB VIII) und – nur in Baden-Württemberg –
  **Baden-Württemberg** (KiTaG). Neue Einrichtungen bekommen sie beim Anlegen. Bestehende Einrichtungen bekamen sie mit
  dem Update auf die Version mit Unterkategorien, wenn es „Gesetze & Vorgaben“ noch gab; dabei wurden nur die Start-Links
  verschoben, die noch unverändert waren (Titel, Beschreibung und Adresse wie geliefert). Alle anderen Kategorien und
  Einträge blieben, wie sie waren. Gelöschte Unterkategorien kommen nicht wieder.

### Einträge

- **PDF**: nur PDF-Dateien bis 30 MB (die App prüft, ob es wirklich ein PDF ist); **Öffnen** zeigt es in einem neuen Tab.
- **Link**: nur Adressen mit http:// oder https:// (ohne wird https:// vorangestellt; andere Arten wie „javascript:“ sind
  nicht erlaubt). Der Link öffnet sich in einem neuen Tab.
- **Text**: höchstens 4000 Zeichen; **Lesen** klappt ihn auf. Beim Speichern bleibt nur die erlaubte Formatierung übrig.
- Dazu: **Titel** (bis 120 Zeichen), **Beschreibung** (freiwillig, bis 500 Zeichen) und **„Stand vom“** (freiwillig; steht
  als Hinweis am Eintrag).
- Das **Suchfeld** sucht in Titel, Beschreibung und Text aller Kategorien.
- **Reihenfolge**: Die Einträge der Einrichtung lassen sich in ihrer Kategorie (bzw. Unterkategorie, oder unter
  „Allgemein“) mit den Pfeilen **Nach oben / Nach unten** schieben; Einträge des Trägers für alle Einrichtungen stehen
  danach, nach Titel. Unter **Alle** schieben die Pfeile innerhalb der jeweiligen Gruppe. Ein Eintrag, der in eine andere
  Kategorie oder Unterkategorie kommt, steht dort am Ende.
- **Für alle Einrichtungen** (nur der Träger): wie bei den Vorlagen mit einem **Kategorie-Namen**, freiwillig einem
  **Unterkategorie-Namen**, und eigenem „Wer sieht ihn?“. Jede Einrichtung zeigt den Eintrag in ihrer Unterkategorie mit
  diesem Namen, sonst direkt in der Kategorie mit diesem Namen (unter „Allgemein“), sonst unter **„Vom Träger“**; die
  engste Einstellung gewinnt. Ändern und löschen kann ihn nur der Träger.
- **Gilt für** und **Wer sieht ihn?** (beim Anlegen und später mit **Bearbeiten**) wie bei den Vorlagen (Abschnitt 19):
  Einrichtungen (der Träger: „nur ‹Einrichtung›“, alle oder ausgewählte) und je Einrichtung alle oder bestimmte Gruppen
  (nach der Stammgruppe; am Tablet die Stammgruppe der Person, die es entsperrt hat). Das gilt überall: in der Liste, der
  Suche, beim Öffnen der PDF, beim Text und bei „Gelesen und verstanden“ (am Tablet zählt die Person, die bestätigt).
  **Wer hat bestätigt?** erwartet nur noch die Mitarbeitenden, die den Eintrag sehen. Ändert sich „Gilt für“ oder „Wer
  sieht ihn?“, bleiben die Bestätigungen erhalten und es gibt keine neue Fassung; wer nicht mehr dazugehört, steht mit
  „nicht mehr angestellt oder sieht den Eintrag nicht mehr“ in der Liste. Die Suche findet „ä“ auch als „ae“ und „ß“ als „ss“.

### „Gelesen und verstanden“

- Wer einen Eintrag anlegt, kann **„Gelesen und verstanden“ erforderlich** ankreuzen. Dann zeigt der Eintrag den Knopf
  **Gelesen und verstanden**.
- **Mit dem eigenen Zugang** bestätigt die Person für sich – dafür muss der Zugang mit ihrem Mitarbeiter-Eintrag
  verknüpft sein. Danach steht dort **„Bestätigt am …“**. Unter **Dokumente** zeigt das Menü die Zahl der noch offenen
  Einträge („Dokumente (2)“), ebenso der Reiter **Wissen**.
- **Am Tablet** (Kachel **Wissen** auf der Startseite; lesen geht ohne PIN) tippt die Person nach **Gelesen und
  verstanden** auf ihren Namen und gibt ihre **PIN** ein (wie beim Stempeln; falsche Versuche zählen
  wie beim Stempeln). Die Bestätigung gilt für diese Person.
- **Geändert**: Wird die **Datei, der Link oder der Text** eines Eintrags geändert, gilt das als neue Fassung – alle
  müssen neu bestätigen; bei den Personen steht dann „Frühere Fassung bestätigt am …“. Titel, Beschreibung, „Stand vom“
  oder die Kategorie zu ändern fragt nicht neu. Wurde ein Eintrag geändert, während jemand ihn offen hatte, nimmt die App
  die Bestätigung nicht an („Der Eintrag wurde inzwischen geändert …“) und zeigt die neue Fassung – so bestätigt niemand
  eine Fassung, die er nicht gesehen hat (am Tablet, bevor die PIN geprüft wird).
- **Wer hat bestätigt?** (Leitung und Träger): je Eintrag die Mitarbeitenden der Einrichtung, die heute angestellt sind
  und den Eintrag sehen (bei „nur Leitung und Träger“ nur diese), aufgeteilt in **noch nicht bestätigt**, **nur frühere
  Fassung** und **bestätigt** (mit Datum und ob am Tablet oder mit eigenem Zugang). Wer bestätigt hat und inzwischen
  ausgeschieden ist, steht mit Hinweis dabei, ebenso Aushilfen aus anderen Einrichtungen, die einen eigenen Eintrag der
  Einrichtung am Tablet bestätigt haben. Bei Einträgen des Trägers für alle Einrichtungen stehen nur die eigenen
  Mitarbeitenden der Einrichtung in der Liste. **Nachweis drucken** gibt die Liste als Ausdruck bzw. PDF aus, mit der
  Fassung und dem Tag, seit dem sie gilt („Fassung 2 vom …“).

### Wer was darf

| Wer | Was |
|---|---|
| Träger | alles, in der gewählten Einrichtung; zusätzlich Einträge **für alle Einrichtungen** |
| Leitung (Recht „Wissen: pflegen“, voreingestellt an) | Einträge und Kategorien der Einrichtung pflegen, sehen, wer bestätigt hat |
| Mitarbeiter, Gruppenleitung (Recht „Wissen lesen“ hat jedes Konto), Tablet | lesen und „Gelesen und verstanden“ bestätigen |

Das Recht „Wissen: pflegen“ steht auf der Seite **Rechte und Rollen** (Bereich „Wissen“).

### Datenschutz und Löschen

- Die Einträge selbst enthalten keine Daten von Kindern oder Mitarbeitern; sie gehören zur Einrichtung und würden mit ihr
  gelöscht. Ein gelöschter Eintrag nimmt seine Lesebestätigungen mit – **vor dem Löschen eines Eintrags den Nachweis
  drucken**, wenn er noch gebraucht wird.
- Die **Lesebestätigungen** sind personenbezogen (wer hat was wann gelesen) und zugleich der Nachweis einer Unterweisung
  (z. B. Kinderschutzkonzept, Hygieneplan, Aufsichtspflicht). Sie gehören deshalb wie die Fortbildungsnachweise zu
  **„Beurteilungen und Zeugnisse“** (voreingestellt 3 Jahre nach dem Ende des Jahres, in dem die Person ausgeschieden ist;
  Mehr → Löschfristen, siehe Abschnitt „Löschfristen“); „Endgültig löschen“ im Archiv der Mitarbeiter-Seite löscht sie
  sofort mit.

## 29. Schulbezirke (Straßenliste der Stadt)

Mit der Straßenliste der Stadt (welche Hausnummern welcher Straße zu welchem Grundschulbezirk gehören) zeigt die
Kinderakte, zu welchem **Schulbezirk** die Adresse eines Kindes gehört, und die Liste der Schulkinder lässt sich nach
Bezirk ordnen und drucken.

### Liste hochladen und pflegen (Einstellungen → Kinder → Schulbezirke)

- **Wer:** die eigene Liste der Einrichtung pflegen Leitung und Träger (Recht „Einstellungen der Einrichtung“). Der Träger
  kann außerdem eine **Liste für alle Einrichtungen** hinterlegen (Recht „Einstellungen anderer Einrichtungen“); sie gilt
  für jede Einrichtung ohne eigene Liste. Die Leitung sieht die Liste des Trägers und kann sie herunterladen.
- **Hochladen:** PDF mit Text (z. B. die Liste der Stadtverwaltung) oder CSV (Semikolon oder Komma, UTF-8 oder
  Windows-Zeichensatz). Eine **Excel-Datei** bitte zuerst als CSV speichern. Höchstens 10 MB (weniger als die 30 MB anderer Dateien: so bleibt das Lesen einer PDF im Speicher des
  Leseprozesses) und 20 000 Zeilen. Eine
  gescannte PDF ohne Text lässt sich nicht lesen.
- **CSV-Spalten** (erste Zeile): `Straße; von; bis; Seite; Bezirk; Schule; Prüfen; Hinweis` – so sieht auch der
  Download aus. Es geht auch kürzer: `Straße; Hausnummer; Bezirk` mit Hausnummern wie `2-14` oder `1-3 A`. „Seite“ ist
  `gerade`, `ungerade` oder `alle`; leer heißt: aus den Hausnummern (beide gerade → gerade Seite, beide ungerade →
  ungerade Seite, gemischt → alle). Bezirk-Nummern werden zweistellig („1“ und „01“ sind derselbe Bezirk – Excel macht
  aus „02“ gern „2“).
- **Vorschau:** Die Datei wird auf dem Server gelesen, aber noch nicht gespeichert. Gelb markiert sind Zeilen, die mit der
  Vorlage verglichen werden sollten: **„Nummer unklar“** (nach dem Bereich steht noch eine Zahl, z. B. „1- 23 1“; der
  Bereich davor wird genommen), **„Bereich war umgedreht“** (z. B. „22 - 14“ wird zu 14–22) und **„überschneidet sich mit
  anderem Bezirk“** (gleiche Straße und Seite, Bereiche überlappen, verschiedene Bezirke). Rot: unvollständige Zeilen;
  sie müssen vor dem Speichern korrigiert oder gelöscht werden. Zeilen lassen sich einzeln bearbeiten, löschen und
  hinzufügen; „Geprüft“ nimmt die gelbe Markierung weg. Zeilen der Datei, die nicht erkannt wurden, stehen über der
  Tabelle.
- **Bezirke und Schulen:** Jeder Bezirk bekommt den Namen der Schule (aus der Legende der PDF vorgeschlagen, z. B.
  „1 Zeyherschule“ → Bezirk 01) und optional die Schule aus den **Kontakten**. Für die eigene Liste: die Schulen, die
  auch als „künftige Schule“ wählbar sind; für die Liste des Trägers: die Schulen des Trägers für alle Einrichtungen.
- **Speichern** ersetzt die gespeicherte Liste vollständig (mit Rückfrage), mit Name und **Stand** (z. B. „2021“ oder
  „01.09.2021“). **Als CSV herunterladen** liefert die gespeicherte Liste im Format, das das Hochladen wieder liest.
- **Sicherheit:** Hochgeladene Dateien gelten als nicht vertrauenswürdig. Eine PDF wird in einem **eigenen Node-Prozess**
  gelesen (ohne Skripte, Schriften oder Formulare), nie im Server selbst: Vorab werden alle komprimierten Bereiche mit
  einer Obergrenze entpackt (zusammen höchstens 96 MB – eine „Zip-Bombe“ wird so sofort abgelehnt); danach beendet der
  Server den Leseprozess, sobald er mehr als 320 MB Speicher belegt, länger als 20 Sekunden braucht oder nicht mehr
  antwortet; mehr als 300 Seiten werden abgelehnt. Es wird immer nur **eine PDF gleichzeitig** gelesen (sonst: „Bitte
  gleich noch einmal versuchen“). Zeilen über 300 Zeichen gelten als „nicht erkannt“. Die hochgeladene Datei selbst wird
  nicht gespeichert. Der Server muss als `node .output/server/index.mjs` gestartet werden (wie im Docker-Image), sonst
  findet er pdf.js nicht und meldet das im Log.
- **Speicher des Containers:** Die App läuft mit höchstens **1024 MB** für alles. Der Server selbst braucht etwa
  150–300 MB; der Leseprozess für eine PDF darf höchstens 320 MB belegen (JavaScript-Speicher 160 MB) und wird darüber
  sofort beendet – so bleibt auch mit einer großen Hochladung genug Luft, damit der Container nie den Server selbst
  beendet. Die echte Straßenliste (8 Seiten) braucht etwa 110 MB. Wer den Container kleiner macht, muss diese Werte
  (server/lib/pdfText.ts, `PDF_TEXT_LIMITS`) mit verkleinern.
- **Bezirk-Nummern** dürfen nur Buchstaben, Ziffern, Leerzeichen, Punkt, Bindestrich und Schrägstrich enthalten (höchstens
  10 Zeichen); Zeilen mit anderen Bezirken gelten beim Hochladen als „nicht erkannt“.

### In der Kinderakte

- Unter den Stammdaten steht **„Schulbezirk 02 – Südstadtschule (laut Liste, Stand 2021)“**.
  Das wird bei jedem Öffnen aus der Adresse berechnet (nicht gespeichert): Ändert sich die Adresse oder die Liste, ändert
  sich die Anzeige. Das Freitextfeld „Schulbezirk“ der Stammdaten bleibt daneben unverändert.
- Gelesen wird die erste Zeile der Adresse mit Hausnummer (Straße, Nummer, Buchstabe wie „12a“ oder „3 A“); Zeilen mit
  Postleitzahl werden übersprungen, Postleitzahl und Ort in derselben Zeile („Ahornweg 12 68723 Stadt“) abgeschnitten.
  Verglichen wird ohne Groß-/Kleinschreibung, „ß“ = „ss“, „ä“ = „ae“ usw., „Str.“/„Str“/„Strasse“ = „Straße“,
  Bindestriche und Leerzeichen zählen nicht. Abgeschnittene Namen der Liste (z. B. „Clementine-Bassermann-St“: endet
  auf „-St“/„Str“ oder ist sehr lang ohne „-straße“, „-weg“ usw. am Ende) passen als Anfang, wenn nur ein solcher Name
  so anfängt – ein vollständiger Name wie „Am Alten Rathaus“ steht nie für „Am Alten Rathausplatz“, und eine Adresse mit
  weiteren Zahlen (die nicht als Hausnummer gelesen wurden) wird nie so zugeordnet. „bis 14“ schließt 14a ein,
  „bis 3 A“ schließt 3a ein, aber nicht 3b.
- **„Adresse nicht in der Liste“:** Straße oder Hausnummer kommt nicht vor (oder die Adresse liegt in einer anderen
  Stadt – die Liste kennt keine Postleitzahl). **„nicht eindeutig: 01, 03 – bitte von Hand wählen“:** mehrere Zeilen
  verschiedener Bezirke passen (Überschneidung in der Liste, oder Adresse ohne Hausnummer in einer geteilten Straße).
- **„Übernehmen“:** Hat der Bezirk eine Schule aus den Kontakten und das Kind noch keine „künftige Schule“, trägt ein
  Klick diese Schule ein (wer die Stammdaten ändern darf, auch am entsperrten Tablet). Automatisch wird nie etwas
  eingetragen.

### Liste der Schulkinder

Kinder → Belegung → **„Schulkinder zum 1.9.“** zeigt, sobald eine Liste gilt, die Spalte **Schulbezirk**, die Anzahl je
Bezirk, einen Filter nach Bezirk, **„nach Schulbezirk gruppieren“** und **„Nach Schulbezirk drucken“** (eine Liste je
Bezirk mit Anzahl).

### Datenschutz

Die Straßenlisten enthalten keine personenbezogenen Daten. Der Bezirk eines Kindes wird nur auf dem Server und nur für
Kinder berechnet, die die Person ohnehin sehen darf, und nirgends gespeichert. Die eigene Liste gehört zur Einrichtung
und würde mit ihr gelöscht; eine Schule, die aus den Kontakten gelöscht wird, verschwindet aus der Zuordnung des Bezirks.
