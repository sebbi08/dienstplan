# Dienstplan – Betrieb auf dem Server

Diese Anleitung beschreibt, wie der Dienstplan auf einem eigenen Server läuft.
Du brauchst dafür einen Linux-Server mit installiertem **Docker** (inklusive „Docker Compose“).

## 1. Dateien auf den Server bringen

Kopiere den kompletten Projektordner auf den Server, z. B. nach `/opt/dienstplan`.

## 2. Einstellungen festlegen

1. Kopiere `deploy/.env.example` nach `/opt/dienstplan/.env`.
2. Trage ein:
   - `NUXT_SESSION_PASSWORD`: mindestens 32 zufällige Zeichen (z. B. aus einem Passwort-Manager).
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
PNG-Dateien bis 10 MB pro Dokument. Es gibt keinen separaten Ordner mit Dokumenten: Wer die
Datenbank hat, hat alles.

### Einwilligungen

Die Einwilligungen in der Akte (ja / nein / offen) sind in Blöcke geteilt: **„Datenschutz“**, **„Messenger
(WhatsApp, Signal)“** mit „Kontaktaufnahme über WhatsApp“, „Fotos über WhatsApp versenden“, **„Fotos über Signal
versenden“** und „WhatsApp-Elterngruppe“, und **„Gesundheit“** mit **„Darf mit Insektenschutz eingesprüht
werden“**. Bei „nein“ zum Insektenschutz steht in der Anwesenheitsliste (und im Ausdruck) „kein
Insektenschutz“. Die neuen Punkte sind bei allen Kindern zunächst offen und zählen in der Liste „Offen“ wie die
anderen. Früher gab es „Fotos über WhatsApp versenden“ zweimal (auch unter Datenschutz); die beiden Werte wurden
zusammengeführt: war einer offen, gilt der andere; widersprachen sich ja und nein, gilt **nein**.

### Wer sieht was

| Rolle | Kinderakten |
|---|---|
| Träger und Leitung | sehen alles in ihrer (gewählten) Einrichtung: alle Kinder, auch vertrauliche Dokumente. Nur sie dürfen ein Kind abmelden, das Archiv sehen und Akten löschen. Das gilt im Büro und am Tablet. |
| Mitarbeiter | sehen die Kinder **nur am Tablet der eigenen Einrichtung**, und dort nur lesend: alle aktiven Kinder, Vormerkungen und künftige Vertragskinder nur, wenn die Schalter (siehe unten) an sind. Vertrauliche Dokumente öffnen sie nicht (Art und Datum sehen sie, den Titel nicht), und abgemeldete Kinder (Archiv) sehen sie nicht. Mit dem eigenen Konto (Handy, privater PC) sehen sie keine Kinder. |
| Mitarbeiter mit der Berechtigung „darf Kinderakten pflegen“ | dürfen am Tablet zusätzlich Kinder anlegen und bearbeiten, Dokumente hochladen und vertrauliche Dokumente öffnen. Abmelden, Archiv und Löschen bleiben der Leitung und dem Träger vorbehalten. |
| Aushilfen aus einer anderen Einrichtung | sehen die Kinder am Tablet nur an den Tagen, an denen sie dort eingeplant sind, und nur lesend. |

Die Berechtigung „darf Kinderakten pflegen“ vergibst du unter *Benutzer* pro Mitarbeiter oder bei der Person selbst
(*Mitarbeiter → Name → Zugang*). Sie gilt am Tablet der Einrichtung.

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

### Automatische Löschung

- Wird ein Kind abgemeldet, kommt die Akte ins Archiv.
- Die App prüft **täglich**, ob die Aufbewahrungsfrist abgelaufen ist, und löscht dann die archivierten
  Akten samt Dokumenten endgültig.
- Die Frist stellt der Träger unter *Einstellungen → Einrichtung* ein: „Löschfrist für abgemeldete Kinder“,
  1 bis 10 Jahre, voreingestellt sind **3 Jahre**.
- Besprich die Frist mit dem/der Datenschutzbeauftragten, bevor du sie festlegst.

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
  Einrichtung. Soll ein Kind, das am Tag nach dem Stichtag geboren ist, noch dazugehören, stelle den Stichtag
  einen Tag später ein.
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
  bei jedem Kind, **an welchem Tag seine Akte gelöscht wird**. Erst nach deiner Bestätigung wird eingeschaltet
  und abgemeldet.
- Danach bekommen alle Schulkinder am 1. September den Austritt 31. August und kommen ins Archiv.
  Ab dann läuft die Löschfrist (siehe Abschnitt 8).
- **Nicht abgemeldet** werden Kinder mit späterem, von Hand eingetragenem Schulstart, Kinder, die erst am oder
  nach ihrem Schulstart aufgenommen wurden, Kinder, deren Akte mit dem Austritt sofort gelöscht würde, und
  Kinder, die in einer Gruppe „für Schulkinder“ sind oder dorthin wechseln. Diese meldest du bei Bedarf von
  Hand ab.
- **Schulkinder-Gruppen (z. B. Hort):** Der Träger kennzeichnet sie in der Gruppenverwaltung. Beim Wechsel in
  eine solche Gruppe musst du bestätigen, dass ein weiterer Betreuungsvertrag abgeschlossen wurde. Der
  Betreuungsvertrag ist danach „nicht bestätigt“, bis der neue Vertrag hochgeladen ist.
- **Der Schalter schaltet sich von selbst aus**, wenn der Stichtag geändert wird, wenn einer Gruppe das
  Kennzeichen „für Schulkinder“ genommen oder eine solche Gruppe gelöscht wird oder wenn die Löschfrist
  geändert wird. Die App weist darauf hin. Prüfe dann die Liste und schalte wieder ein.

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
  Stichtage stehen im Stand Oktober 2026; prüfe sie bei Änderungen des Schulgesetzes.

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
  „darf Kinderakten pflegen“. Vertrauliche Dokumente öffnet die Person dort nur, wenn sie das in der eigenen Gruppe
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
| Notfallkontakte | je Spalte ein Notfallkontakt in seiner Reihenfolge (1., 2., …) mit Beziehung und Telefonnummern |
| Telefonnummern | Adresse · je Spalte eine Bezugsperson (in der Reihenfolge der Akte) mit Beziehung und Telefon privat / mobil / Arbeit |
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
  darauf klappt sie auf. Beim Träger steht dort auch der Schalter „Vertragsangaben für die Leitung sichtbar“.
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
  löschen“): **aus** (niemand, nur noch die automatische Löschung nach den Fristen), **nur Träger** oder **Leitung und
  Träger** (voreingestellt). Endgültig löschen beachtet die Aufbewahrungsfristen **nicht** – nur für Probe- und
  Fehleinträge; der Dialog weist darauf hin.
- Ein Dialog zählt auf, was gelöscht wird. Zum Bestätigen **tippst du den Namen genau so ein**, wie er dasteht; erst
  dann geht der Knopf. **Das lässt sich nicht rückgängig machen** – braucht ihr die Daten vielleicht noch, lädt der
  Träger vorher eine Sicherung herunter.
- **Gelöscht werden:** Stammdaten, Wochenstunden, Vertragsdaten und Stempel-PIN; alle Dienstplan-Einträge aller Monate
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

Die Daten ausgeschiedener Mitarbeiter löscht die App **automatisch im täglichen Lauf** (einmal am Tag), je
nach Art zu einem anderen Tag. Jede Frist beginnt am **Ende des Jahres**, in dem die Person ausgeschieden ist; gelöscht
wird am 1. Januar danach. Beispiel: ausgeschieden am 15.03.2026, Frist 2 Jahre → gelöscht am 01.01.2029.

| Wann | Was |
|---|---|
| am Tag nach „ausgeschieden am“ | Geburtstag, PIN, Benutzerkonto (Leitung/Mitarbeiter gelöscht, ein Träger-Konto nur gelöst), Qualifikation, Vertragsdaten, Wochenstunden-Verläufe, Pflichttermine, Urlaubsanträge, Aushilfen, Benachrichtigungen, Freischaltungen für Bögen; als Bezugserzieher wird die Person bei Kindern entfernt |
| „Sonstige Überstunden- und Zeitdaten“ (voreingestellt 2 Jahre) | Dienstplan-Einträge mit Änderungsprotokoll, Stempelzeiten, Notizen der Zeiterfassung, „Im Dienst erkrankt“, Stundenkonto-Buchungen ohne „ausgezahlt“, Krankheitstage, Urlaubsansprüche |
| „Beurteilungen und Zeugnisse“ (3 Jahre) | Mitarbeitergespräche mit allen Bögen, Fortbildungsnachweise |
| „Ausgezahlte Überstunden“ (10 Jahre) | Stundenkonto-Buchungen mit dem Häkchen **„ausgezahlt“** (setzt du beim Anlegen der Buchung) |
| „Betriebliche Altersvorsorge“ (30 Jahre) | nur zur Information, die App speichert dazu nichts |
| zuletzt | der Mitarbeiter-Eintrag selbst (Name, Kürzel, Gruppe), sobald keine Frist mehr läuft |

- Die Fristen stellt der **Träger** je Einrichtung unter *Einstellungen → Personal → Löschfristen* ein (1 bis 40 Jahre;
  „Einstellungen für“ geht auch hier). Die Leitung sieht sie dort nur. Dort stehen auch „Mitarbeiter endgültig
  löschen“ (siehe oben) und die „Aufbewahrungsfrist Kasse“ (1 bis 30 Jahre, voreingestellt 10).
- Eine geänderte Frist gilt ab dem nächsten täglichen Lauf. Schon Gelöschtes kommt nicht zurück.
- Im Abschnitt „Ausgeschiedene Mitarbeiter“ steht bei jeder Person, wann was gelöscht wird („Zeitdaten werden am …
  gelöscht, Beurteilungen am …, ausgezahlte Überstunden am …, danach der Eintrag.“).
- Wird das Ausscheiden zurückgenommen (Datum entfernt oder in die Zukunft verschoben), löscht die App nichts weiter.
- Das Server-Protokoll nennt nach jedem Lauf, wie viele Datensätze je Art gelöscht wurden (ohne Namen).
- Die Fristen sind vorbelegt nach den Vorgaben des Trägers – bitte im Zweifel mit Steuerberatung bzw. Datenschutz
  klären. Gelöschtes steckt noch in älteren Sicherungen (siehe Abschnitt 8, „Gelöschte Daten und Sicherungen“).

### Die Seite einer Person

Ein Tipp auf den Namen öffnet die Seite der Person. Sie ist in Reiter aufgeteilt: **Stammdaten** (Name, Kürzel,
ausgeschieden am, Gruppe, Geburtstag; beim Träger auch „in andere Einrichtung verschieben“) · **Stunden & Vertrag**
(Stundenkonto heute und am Ende eines wählbaren Monats, Wochenstunden, Stundenkonto-Buchungen, Vertragsangaben) ·
**Urlaub** (Urlaubskonto eines wählbaren Jahres: Anspruch, Übertrag, genommen, verplant, frei verfügbar; dazu der
Urlaubsanspruch) · **Zeiterfassung & PIN** · **Qualifikation** (Personalschlüssel) · **Pflichttermine** · **Zugang**.
Die App merkt sich keinen Reiter; sie öffnet immer mit „Stammdaten“, außer ein Link führt direkt zu einem Reiter (z. B.
aus dem Hinweis auf Pflichttermine). Was du in einem Reiter eingibst, bleibt beim Wechsel in einen anderen Reiter
stehen. **Speichern speichert nur die Felder des Reiters, in dem du gerade bist** – Eingaben in einem anderen Reiter
werden dabei nicht mitgespeichert und auch nicht gelöscht.

### Zugang (Benutzerkonto der Person)

- Im Reiter **Zugang** richtest du für eine Person ohne Konto mit **„Zugang einrichten“** ein Benutzerkonto ein: Der
  Benutzername ist aus dem Namen vorgeschlagen (klein, ohne Leerzeichen, ä/ö/ü/ß als ae/oe/ue/ss) und lässt sich
  ändern. Dazu ein Startpasswort (mindestens 8 Zeichen) und die Rolle **Mitarbeiter** oder **Leitung**. Das Konto ist
  gleich mit der Person verknüpft; sie muss das Passwort bei der ersten Anmeldung ändern.
- Hat die Person schon ein Konto, siehst du dort Benutzername, Rolle, „aktiv“ (und bei Mitarbeitern „darf Kinderakten
  pflegen“) und kannst das **Passwort zurücksetzen**. Es gelten dieselben Rechte wie unter *Benutzer*: Ein Träger-Konto
  kann nur ein Träger ändern.

### Die Seite *Benutzer*

Unter *Benutzer* stehen weiterhin **alle Konten**. Dort legst du vor allem Konten an, die zu keinem Mitarbeiter
gehören (Stempel-Tablet; der Träger auch Träger-Konten), und kannst die Konten ändern (Träger-Konten nur der Träger). Die lange Übersicht, was jede Rolle darf, ist beim
Träger zugeklappt: **„Rechte der Rollen anzeigen“** klappt sie auf. Auf dem Handy lässt sich die Tabelle der Konten
seitlich wischen.

### Stempel-PIN

- Mit der PIN stempelt jeder Mitarbeiter am Kita-Tablet und schließt dort die Kinder auf. Die PIN hat **genau
  6 Ziffern**. Leitung und Träger setzen sie unter *Mitarbeiter → Name → Zeiterfassung & PIN* (nur für die Mitarbeiter der
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

## 19. Vorlagen (leere Formulare zum Ausdrucken)

Unter **Vorlagen** liegen leere PDF-Formulare, die man immer wieder ausdruckt – z. B. Elternbriefe,
Einverständniserklärungen, ein Formular für Medikamente oder einen Urlaubsantrag.

- **Hochladen**: Leitung und Träger öffnen im Menü unter **Mehr** → **Vorlagen** und tippen auf **Vorlage hochladen**. Erlaubt sind nur
  **PDF-Dateien bis 10 MB** (wie bei den Dokumenten der Kinder; die App prüft, ob es wirklich ein PDF ist). Der
  **Titel** wird aus dem Dateinamen vorgeschlagen und lässt sich ändern. Die **Kategorie** ist frei wählbar; die App
  schlägt die schon benutzten vor (und „Eltern“, „Gesundheit“, „Personal“). Ohne Kategorie landet die Vorlage unter
  „Sonstiges“.
- **Für wen**: Die **Leitung** lädt Vorlagen für die **eigene Einrichtung** hoch. Der **Träger** wählt beim Hochladen
  „nur ‹Einrichtung›“ (die oben gewählte) oder **„alle Einrichtungen“**. Jede Einrichtung sieht ihre eigenen Vorlagen und
  die für alle Einrichtungen; diese sind mit **„alle Einrichtungen“** markiert.
- **Ändern**: Mit **Bearbeiten** lassen sich Titel und Kategorie ändern und die Datei durch eine neue ersetzen;
  **Löschen** fragt vorher nach. Die Vorlagen für alle Einrichtungen kann **nur der Träger** ändern oder löschen.
- **Drucken**: **Öffnen** zeigt das PDF in einem neuen Tab; dort druckst du es mit der Druckfunktion des Browsers.
- **Am Tablet**: Auf der Startseite des Tablets gibt es den Knopf **Vorlagen**. Dort lassen sich alle Vorlagen der
  Einrichtung öffnen und drucken – **ohne PIN**, weil darin keine Daten von Kindern stehen. Hochladen und ändern geht am
  Tablet nicht.
- **Nicht auf dem Handy**: Mitarbeiter sehen die Vorlagen mit ihrem eigenen Konto (Handy, privater PC) nicht.

## 20. Personalschlüssel

Die App rechnet je Gruppe und für die ganze Einrichtung aus, wie viel pädagogisches Personal nach den Vorgaben des
Bundeslands nötig ist (**Soll**), und vergleicht das mit dem Dienstplan (**Ist**). Sie ist eine **Planungshilfe – keine
rechtliche Prüfung.** Bitte die Vorgaben mit der Heimaufsicht/dem Landesjugendamt abgleichen. Dieser Hinweis steht
auch im Reiter und in den Einstellungen.

### Was vorher eingetragen sein muss

- **Bundesland** der Einrichtung (Einstellungen → Einrichtung → Einrichtungen, Träger). Danach richten sich alle Zahlen.
- **Qualifikation** bei jedem Mitarbeiter (Mitarbeiter → Name → Qualifikation, Leitung oder Träger): Fachkraft,
  Ergänzungs-/Zusatzkraft, Auszubildende/r (1./2./3. Jahr), Praktikant/in oder **keine pädagogische Kraft**. Küche,
  Hauswirtschaft und Reinigung bitte als „keine pädagogische Kraft“ eintragen, sonst zählen sie mit.
  „Anrechnung in %“ bleibt meist leer: dann gilt die Vorgabe des Landes für die Qualifikation (sie steht grau im
  Feld). Eine eigene Zahl (0 bis 100) gilt nur für diese Person.
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

## 21. Codes (Urlaub, Krank …)

Die Codes für Abwesenheiten (Urlaub, Krank, Fortbildung …) gelten für **alle Einrichtungen**. Bezeichnung, Farbe und
Anrechnung ändert deshalb **nur der Träger** unter *Einstellungen → Dienstplan → Codes*. Die Leitung sieht die Codes dort nur zum
Lesen (mit dem Hinweis „Codes kann nur der Träger ändern.“).

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
  Einrichtungen, Codes, Urlaubsanträge an/aus, Löschfrist, Datensicherung), bleibt davon unberührt. Nur die Auswahl der
  Zuständigen für die Urlaubsplanung zeigt die Leitungen der gewählten Einrichtung (bereits gewählte Zuständige anderer
  Einrichtungen bleiben gespeichert). In „Was noch fehlt“ sind Einträge, die zu Seiten außerhalb der Einstellungen führen
  (z. B. eine Person oder ein Kind), dann kein Link: Wechsle dafür oben die Einrichtung. Ungespeicherte Änderungen fragt
  die App vor dem Wechsel ab; auf der Seite einer Gruppe geht es zurück zur Gruppenliste. Die Leitung hat diese Auswahl
  nicht.
- **Leitung und Träger** sehen oben immer: **Dienstplan**, **Urlaubsplanung** (nur wer dafür zuständig ist, mit der Zahl
  offener Anträge), **Zeiterfassung**, **Mitarbeiter**, **Kinder**, **Kasse**, **Kalender** (Jahreskalender) und **Teamsitzungen**. Seltener Gebrauchtes liegt
  unter **Mehr**: Schließzeiten, Krankheitstage, Vorlagen, Bögen, Benutzer, Einstellungen und Passwort ändern.
  Wer als Leitung oder Träger auch einen eigenen Mitarbeiter-Eintrag hat, findet unter **Meins** „Mein Dienstplan“,
  „Mein Urlaub“, „Meine Termine“ und „Meine Gespräche“; die Zahl ungelesener Änderungen steht an **Meins** und an „Mein Dienstplan“. „Mehr“ und „Meins“ sind
  hervorgehoben, wenn man gerade auf einer ihrer Seiten ist. Der eigene Benutzername steht auf breiten Bildschirmen
  rechts; auf kleineren Laptops ist **Abmelden** nur ein Symbol, der Name erscheint beim Zeigen darauf.
- **Mitarbeiter** sehen oben **Mein Dienstplan** (mit der Zahl ungelesener Änderungen), **Dienstplan**, **Kalender** und
  **Teamsitzungen**; unter **Meins** liegen „Mein Urlaub“, „Meine Termine“ und „Meine Gespräche“.
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
  sieht nur der Träger, weil nur er sie einträgt.
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
  10.03.2026 → löschbar ab 01.01.2037). Ab diesem Tag erscheint **Endgültig löschen** (Leitung und Träger): Du tippst zur Bestätigung den Namen der
  Kasse ein; gelöscht werden die Kasse, alle Buchungen, Belege, abgeschlossenen Monate und das Protokoll. Umbuchungen mit
  anderen Kassen bleiben dort als normale Buchung stehen, mit ihrem Text; in deren Protokoll steht „Andere Kasse
  gelöscht“. Eine archivierte Kasse ohne jede Buchung lässt sich sofort löschen. Die App löscht Kassen nie von selbst.
- **Monatsblatt:** ein Tipp auf den Namen öffnet den laufenden Monat; mit den Pfeilen geht es zurück bis zum Startmonat.
  Oben stehen wie im bisherigen Kassenblatt Anfangsbestand, Einnahmen, Ausgaben und aktueller Kassenbestand; der
  Anfangsbestand ist immer der Endbestand des Vormonats. Darunter die Einträge nach Datum, die Nummern getrennt für
  Einnahmen und Ausgaben (nach dem Löschen rücken die übrigen nach). Am Handy steht jeder Eintrag als Karte da.
- **Einnahme / Ausgabe:** Datum (im gezeigten Monat, nicht in der Zukunft), Betrag mit Komma oder Punkt (z. B. 12,50) und
  Verwendungszweck; beim Tippen schlägt die App frühere Texte vor. **Beleg** freiwillig: **Foto aufnehmen** (Handy) oder
  **Datei wählen** (JPG, PNG oder PDF, höchstens 10 MB). „Beleg ansehen“ öffnet ihn in einem neuen Fenster.
- **Umbuchen:** von dieser Kasse an eine andere aktive Kasse der Einrichtung. Die App trägt die Ausgabe hier und die
  Einnahme dort ein; Ändern und Löschen gilt immer für beide.
- **Kassenbestand negativ:** rutscht eine **Barkasse** an einem Tag unter 0 €, erscheint ein roter Hinweis und die
  betroffenen Einträge sind rot. Speichern geht trotzdem. Bei EC/Konto gibt es diesen Hinweis nicht.
- **Monat abschließen:** geht, wenn der Monat vorbei ist (oder ab seinem letzten Tag) und der Vormonat schon
  abgeschlossen ist; warum es noch nicht geht, steht unter dem Knopf. Danach ist der Monat gesperrt. **Wieder öffnen**
  kann nur der Träger, mit Begründung; dabei öffnen sich auch alle späteren abgeschlossenen Monate.
- **Protokoll:** unten aufklappbar; jede Änderung mit Name und Zeitpunkt, auch Abschluss und Wieder-Öffnen. Niemand kann
  es ändern.
- **Drucken** zeigt das Blatt im Aufbau der Vorlage (A4 hoch) mit „Gedruckt am … von …“ und dem Abschluss; dort gibt es
  auch **PDF herunterladen**. **Excel-Datei (Monat)** und **Excel-Datei (Jahr)** laden eine Datei, die Excel direkt öffnet.
- Kassen, Einträge und Belege sind in der normalen Datensicherung enthalten.

## 25. Bögen, Mitarbeitergespräche, Beobachtungsbögen und Teamsitzungen

- **Vorlagen:** im Menü unter **Mehr → Bögen** (Leitung und Träger). Die Seite zeigt die Vorlagen in drei Kästen:
  **Kinder** (Beobachtungen, Entwicklungsgespräche), **Fachkräfte** (Mitarbeitergespräche) und **Team** (Teamsitzungen), jeder
  mit eigenem „Vorlage anlegen“; auf großen Bildschirmen stehen die Kästen nebeneinander. Mit dem **Drucker-Zeichen** bei einer Vorlage druckst du
  sie **leer** (A4 hochkant) – zum Ausfüllen von Hand, mit leeren Kopffeldern, Kästchen, Schreiblinien und Unterschriftszeilen. Jede Einrichtung hat die Startvorlagen **Selbstbeurteilung** und **Beurteilungsbogen pädagogische
  Fachkräfte**. Du kannst Vorlagen anlegen, **kopieren**, **stilllegen** (steht dann eingeklappt unten, schon angelegte
  Bögen bleiben lesbar) und löschen – Löschen geht nur, solange noch kein Bogen damit angelegt wurde.
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

### Beobachtungsbögen

- **Wo:** Kinderakte → Bereich **Beobachtungen** (im Büro und am aufgeschlossenen Tablet, nie auf den Handys der
  Mitarbeiter). Die Liste zeigt die Bögen des Kindes, neueste zuerst, mit Datum, Vorlage und „zuletzt geändert“.
  Jede Einrichtung hat die Startvorlage **Entwicklungsgespräch** (Mehr → Bögen, Kasten „Kinder“).
- **Anlegen:** **Bogen anlegen** – Vorlage, Datum, Uhrzeit (freiwillig) und Teilnehmer. Beim Elterngespräch gibt es
  **Bogen ausfüllen**: Datum, Uhrzeit und Teilnehmer kommen aus dem Gespräch, danach steht dort **Bogen öffnen**. Ein
  Elterngespräch hat höchstens einen Bogen; wird das Gespräch gelöscht, bleibt der Bogen.
- **Wer darf was:** Lesen kann jeder, der die Akte sieht. **Anlegen und ändern** können Leitung und Träger und am
  Tablet der **Bezugserzieher** des Kindes. Andere Mitarbeiter sehen den Bogen nur zum Lesen, bis Leitung oder Träger
  sie über **Mitarbeiter freischalten** für genau diesen Bogen freischalten (zurücknehmbar). Wechselt der
  Bezugserzieher, wechselt das Recht sofort mit. **Löschen** (mit Rückfrage) können nur Leitung und Träger.
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
- **Anlegen:** **Sitzung anlegen** – Vorlage (Startvorlage **Teamsitzung**, eigene unter Mehr → Bögen, Kasten
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
