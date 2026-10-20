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

## 5. Datensicherung

- **Automatisch:** Die App legt jede Nacht eine Kopie der Datenbank im Datenbereich im Ordner `backups`
  ab (Dateiname `app-JJJJ-MM-TT.db`) und behält die letzten 14 Tage.
- **Von Hand:** In der App unter *Einstellungen → Datensicherung → Datenbank herunterladen*
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

Die Berechtigung „darf Kinderakten pflegen“ vergibst du unter *Benutzer* pro Mitarbeiter. Sie gilt am Tablet
der Einrichtung.

Mitarbeiter **mit einer Gruppe** sehen am Tablet nur die Akten ihrer eigenen Gruppe (und der Gruppen, die für sie
freigeschaltet sind, nur lesend) – siehe Abschnitt 12.

### Kinder am Tablet

- Auf der Startseite des Tablets gibt es zwei Knöpfe: **Stempeln** und **Kinder**. Unter „Kinder“ tippt die
  Person ihren Namen an und gibt ihre PIN ein; danach ist das Tablet für sie **aufgeschlossen**. Oben steht
  „Aufgeschlossen: ‹Name›“ mit dem Knopf **Sperren**.
- Für den Zugang braucht jeder Mitarbeiter eine **PIN**. Die vergibt die Leitung wie fürs Stempeln (unter
  *Mitarbeiter*). Auch wer kein eigenes Benutzerkonto hat, kann mit der PIN aufschließen (nur lesen). Nach 5
  falschen PINs ist die Person 15 Minuten gesperrt – beim Stempeln und beim Aufschließen.
- Das Tablet sperrt sich wieder, wenn die **Sperrzeit** ohne Bedienung abgelaufen ist, wenn jemand „Sperren“
  antippt, die Kinderseiten verlässt (zur Startseite, zum Stempeln oder zum Dienstplan) oder eine andere Person
  aufschließt. Das merkt das Tablet spätestens nach einer halben Minute auch von selbst, z. B. wenn die Sperrzeit
  verkürzt oder der Person die PIN gelöscht wurde.
- Unter *Einstellungen → Tablet* stellen Leitung und Träger pro Einrichtung ein:
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

### Automatische Löschung

- Wird ein Kind abgemeldet, kommt die Akte ins Archiv.
- Die App prüft **täglich**, ob die Aufbewahrungsfrist abgelaufen ist, und löscht dann die archivierten
  Akten samt Dokumenten endgültig.
- Die Frist stellt der Träger unter den Einstellungen ein: „Löschfrist für abgemeldete Kinder“,
  1 bis 10 Jahre, voreingestellt sind **3 Jahre**.
- Besprich die Frist mit dem/der Datenschutzbeauftragten, bevor du sie festlegst.

### Gelöschte Daten und Sicherungen

Gelöschte Akten stecken noch in älteren Sicherungen. Die automatischen Nachtsicherungen im Ordner
`/data/backups` werden 14 Tage aufbewahrt, danach sind die Daten dort ebenfalls weg. Von Hand
heruntergeladene oder auf andere Rechner kopierte Sicherungen löscht die App nicht. Räume diese selbst auf,
sonst bleiben Kinderdaten über die Löschfrist hinaus erhalten.

### Sicherungen sicher aufbewahren

Die Datei, die du unter *Einstellungen → Datensicherung → Datenbank herunterladen* bekommst, enthält
**alle Kinderdaten inklusive aller Dokumente**. Das Gleiche gilt für die Nachtsicherungen.

- Speichere sie nur an geschützten Orten (verschlüsseltes Laufwerk, zugriffsgeschützter Ordner).
- Gib sie nicht per E-Mail oder über unverschlüsselte USB-Sticks weiter.
- Lösche sie, wenn du sie nicht mehr brauchst.

### Verschlüsselung der Server-Festplatte

Die App verschlüsselt die Datenbank nicht selbst. Verschlüssele deshalb die Festplatte des Servers
(Verantwortung des Betreibers, z. B. mit LUKS unter Linux oder der Verschlüsselung deines Hosters).
Sonst sind die Kinderdaten lesbar, wenn jemand Zugriff auf die Festplatte oder eine Server-Kopie hat.

## 9. Platzplanung (Vormerkungen, Belegung, Gruppenwechsel, Schulkinder)

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

- **Kinder in einer Gruppe „für Schulkinder“ (z. B. Hort)** zählen ohne Enddatum weiter, auch nach ihrem
  Schulstart. Sie werden nie automatisch abgemeldet. Melde sie von Hand ab, wenn sie gehen, sonst bleiben sie
  in der Belegung stehen.
- **Nach dem Verschieben in eine andere Einrichtung** zählt ein Kind in der neuen Einrichtung erst **ab dem Tag
  des Verschiebens**, nicht ab seinem ursprünglichen Eintritt. In der alten Einrichtung erscheint es nicht mehr,
  auch nicht in den zurückliegenden Monaten: Die Akte gehört jetzt zur neuen Einrichtung.

### Gruppenwechsel

Einen Wechsel planst du mit Datum. Am Wechseltag stellt die App das Kind automatisch in die neue Gruppe.
Bereiche, die du nicht übernommen hast (z. B. Gesundheit), bleiben sichtbar und sind als „nicht bestätigt“
markiert, bis jemand sie durchsieht und bestätigt. Alle offenen Fälle stehen im Reiter „Offen“.

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

- **Wer stellt es ein:** Nur der Träger, unter Einstellungen → Einrichtungen. Beim Anlegen einer Einrichtung wählt er
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
  zeigt der Abschnitt „Schulkinder“ diesen mit dem Knopf **„übernehmen“**. Das ist eine normale
  Stichtagsänderung und schaltet die automatische Abmeldung der Schulkinder aus (siehe Abschnitt 9). Die
  Stichtage stehen im Stand Oktober 2026; prüfe sie bei Änderungen des Schulgesetzes.

## 11. Anwesenheit der Kinder

Unter *Kinder* ist **„Anwesenheit“** der erste Reiter. Er öffnet die Tagesliste von heute; mit den Pfeilen,
dem Datum und **„Heute“** wechselst du den Tag, mit **„Monat“** zur Monatsübersicht.

### Ein- und Ausstempeln am Tablet

- Am Tablet stempelt jede aufgeschlossene Person die Kinder ein und aus – auch wer kein eigenes Konto hat und
  Aushilfen an ihren Einsatztagen. Leitung und Träger können das auf jedem Gerät. Mit dem eigenen
  Mitarbeiterkonto (Handy, privater PC) gibt es die Anwesenheit nicht.
- Die Liste zeigt immer **alle** Kinder der Einrichtung. Bei Kindern einer **fremden Gruppe** geht für
  Mitarbeiter mit Gruppe nur Kommen, Gehen und Abholer ankündigen (siehe Abschnitt 12).
- Oben steht, wie viele Kinder da, abgeholt, abwesend und noch nicht da sind, darunter der Kasten **„Essen
  heute“** (siehe „Essen“ unten). Die Liste ist nach Gruppen geordnet (Kinder ohne Gruppe am Ende); wie sie
  aussieht, steht unter „Die Liste am Bildschirm“.
- **„Kommt“**: Uhrzeit (vorgeschlagen ist jetzt) und **geplante Abholzeit** (Pflicht). Vorgeschlagen wird das
  Ende der Betreuungszeit aus der Betreuungsform des Kindes. Ist unter *Einstellungen → Anwesenheit* „Bringperson
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
- **Nicht ausgestempelt**: Wurde ein Kind an einem der letzten 14 Tage nicht ausgestempelt, steht oben ein Hinweis
  mit dem Knopf **„Zum Tag“**. Dort trägst du die Abholung über **„Zeiten korrigieren“** (Stift am Aufenthalt) nach.

### Angekündigte Abholer

Holt heute jemand anderes ab (z. B. die Oma), trägst du ihn mit **„Abholer ankündigen“** ein: Name und
freiwillig „angekündigt von“ (z. B. „Mama, telefonisch“). Die Person gilt nur für diesen Tag, steht beim Kind
(„Abholer heute: …“) und kann beim Gehen gewählt werden. Im selben Dialog kannst du sie wieder entfernen.

### Abwesenheiten

**„Abwesend“** gibt es für ein Kind, das an dem Tag noch nicht da war: krank, Urlaub oder entschuldigt, für
diesen Tag oder bis zu einem Enddatum (z. B. angekündigter Urlaub). Eingetragen wird an Betreuungstagen; Wochenenden,
Feiertage und Schließtage werden übersprungen. Kommt ein abwesend eingetragenes Kind doch, ersetzt „Kommt“ die
Abwesenheit für diesen Tag. Ist an einem vergangenen Betreuungstag nichts eingetragen, gilt das Kind als
unentschuldigt (–) – aber erst ab dem Tag, der unter *Einstellungen → Anwesenheit* bei **„Anwesenheit erfasst ab“**
steht (der erste Eintrag setzt ihn von selbst; Tage davor bleiben leer und zählen nicht).

### Essen

- **Welche Essen es gibt**, legen Leitung und Träger unter *Einstellungen → Anwesenheit* im Block **„Essen“** fest,
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
- **Kasten „Essen heute“** über der Liste (an einem anderen Tag „Essen am 14.10.2026“): je Essen die Zahl der
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

- Unter *Kinder* ist **„Wochenübersicht“** der Reiter nach „Anwesenheit“: am Tablet nach dem Aufschließen, für
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

- Welche anderen Gruppen eine Gruppe zusätzlich **lesen** darf, legt die Leitung unter *Einstellungen →
  Gruppenbücher* fest. Der Träger hat denselben Block *Gruppenbücher* in den Einstellungen (für die gerade gewählte
  Einrichtung) und außerdem *Einstellungen → Einrichtungen* bei den Gruppen jeder Einrichtung. Überall gilt: bei jeder
  Gruppe „Darf zusätzlich lesen:“ mit einem Häkchen je andere Gruppe. Voreingestellt ist keine.
- Das gilt nur in eine Richtung: Darf die Gruppe A die Gruppe B lesen, darf B deshalb noch nicht A lesen.
- Änderungen wirken sofort, auch an einem gerade aufgeschlossenen Tablet.

### Gruppenfarben (Jahreskalender und Urlaubsplanung)

Leitung und Träger geben jeder Gruppe unter *Einstellungen → Gruppenfarben* eine helle Farbe (für die gerade
gewählte Einrichtung; voreingestellt ist „keine Farbe“). Im Jahreskalender, in der Urlaubsplanung, in „Mein
Kalender“ und im Ausdruck des Jahreskalenders stehen die Mitarbeiter dann nach Gruppen sortiert (in der Reihenfolge
der Gruppen, Mitarbeiter ohne Gruppe am Ende), ihr Name hat die Farbe ihrer Stammgruppe, und über dem Kalender
steht eine kleine Legende der Gruppenfarben. Mitarbeiter ohne Gruppe und Gruppen ohne Farbe bleiben weiß. Die
Gruppenfarben sind heller als die Farben, mit denen der Kalender Abwesenheiten zeigt (z. B. das kräftige Blau der
Fortbildung), damit man Name und Abwesenheit nicht verwechselt. Zur Wahl stehen Gelb, Orange, Rosa, Pink, Lila,
Hellbraun, Türkis und Grau – Blau, Grün und Rot gibt es bewusst nicht. Gruppen, die früher „Blau“ hatten, sind nach
dem Update hellbraun.

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

- **Öffnungszeiten:** Im Abschnitt „Öffnungszeiten“ (unter „Pflichtdienste“) trägst du für Montag bis Freitag
  Öffnung und Schließung ein oder hakst „geschlossen“ an. Die Schließung muss nach der Öffnung liegen. Ein Tag ohne
  Eintrag gilt als „nicht eingetragen“: Dafür gibt es keine neue Warnung. Samstag und Sonntag lassen sich nicht eintragen; am Wochenende wird nie gewarnt.
- **Mindestzahlen:** „Mindestens zur Öffnung“ und „Mindestens bis zur Schließung“ (1 bis 20, voreingestellt 1).
- **Eigene Zeiten einer Gruppe:** Unter der Einrichtung steht bei jeder Gruppe aufklappbar „Eigene
  Öffnungszeiten“ mit derselben Tabelle. Leer heißt: Es gelten die Zeiten der Einrichtung, die Gruppe hat dann keine
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
- **Pflichtdienste je Wochentag:** Jeder Pflichtdienst hat die Knöpfe **Mo Di Mi Do Fr** (mindestens einer muss
  gewählt sein). Er wird nur an diesen Tagen geprüft; ist nicht jeder Tag gewählt, steht darunter z. B. „Mo–Do“.
  Bisherige Pflichtdienste gelten weiter an allen Werktagen. An einem als „geschlossen“ eingetragenen Tag wird kein
  Pflichtdienst geprüft (bei einer Gruppe: gilt „geschlossen“ der Gruppe, falls sie eigene Zeiten hat, sonst der
  Einrichtung).
- **Rückwirkend:** Änderungen an Öffnungszeiten und Pflichtdiensten gelten für alle Tage, auch für vergangene Monate.
  Wer nichts einträgt, bekommt keine neuen Warnungen.

## 14. Übersicht der Kinder (wie die Excel-Liste)

Unter *Kinder* ist **„Übersicht“** der Reiter nach „Liste“. Er zeigt die Angaben der Kinder als Tabellen, aufgebaut
wie die Blätter der bisherigen Excel-Liste. Erfasst wird hier nichts: alle Werte kommen aus den Kinderakten und werden
dort geändert. Ein Kind steht je Zeile (Nachname, Vorname), nach Gruppen geordnet wie in der Liste, Kinder ohne Gruppe
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

Wer ausgeschieden ist (das Datum „ausgeschieden am“ liegt vor heute), steht unter *Mitarbeiter* nicht mehr bei den
aktiven Mitarbeitern, sondern am Ende der Seite im zugeklappten Abschnitt „Ausgeschiedene Mitarbeiter“ – gelöscht
wird dabei nichts, der Name führt weiter zu allen Daten der Person.

## 16. Erinnerungen

Oben auf der Seite **Kinder** (über den Reitern) steht der Kasten **„Erinnerungen“**: am Tablet, sobald es
aufgeschlossen ist, bei Leitung und Träger auf jedem Gerät. Mit dem eigenen Konto (Handy, privater PC) sehen
Mitarbeiter keine Erinnerungen – auch nicht die Geburtstage der Kollegen. Der Kasten lässt sich zuklappen; das
Gerät merkt sich, ob er zu- oder aufgeklappt ist. Gibt es nichts zu erinnern, ist er gar nicht da.

Die Einträge stehen in dieser Reihenfolge: überfällig, heute, dann nach Datum.

- **Entwicklungsdokumentation**: „Entwicklungsdoku für Lena Muster fällig am 12.11.“, am Tag selbst „… heute
  fällig“, danach rot „… überfällig seit 12.11.“, bis jemand **„Erledigt“** antippt. Liegt der Tag nicht im
  laufenden Jahr, steht das Jahr dabei („überfällig seit 03.04.2024“).
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

Unter *Einstellungen → Erinnerungen* legen Leitung und Träger für die Einrichtung fest:

- **Geburtstage der Kinder**: wie viele Tage vorher erinnert wird (0 bis 30, voreingestellt 7),
- **Geburtstage der Mitarbeiter**: ebenso (0 bis 30, voreingestellt 7),
- **Abschied**: wie viele Wochen vorher (0 bis 12, voreingestellt 4),
- die **Entwicklungsdokumentation** je Gruppe und für die Kinder ohne Gruppe (voreingestellt jeweils „aus“):
  - **alle X Monate** (1 bis 24): fällig X Monate nach dem letzten „Erledigt“; ohne „Erledigt“ X Monate nach dem
    Eintritt (sonst nach dem geplanten Eintritt), frühestens X Monate nach „gilt seit“ (siehe unten),
  - **um den Geburtstag**: fällig am Geburtstag des Kindes; ohne „Erledigt“ am ersten Geburtstag ab dem Eintritt,
    frühestens ab „gilt seit“. Wer innerhalb der Vorlaufzeit vor dem Geburtstag „Erledigt“ antippt, hat die Doku
    für diesen Geburtstag erledigt,
  - dazu **„erinnern Wochen vorher“** (0 bis 12, voreingestellt 2).

  **„gilt seit“**: Die App merkt sich je Gruppe (und für die Kinder ohne Gruppe) den Tag, an dem die Erinnerung
  eingeschaltet oder die Art („alle X Monate“ / „um den Geburtstag“) gewechselt wurde; er steht in den Einstellungen
  unter der Auswahl. Ohne „Erledigt“ zählt die App erst ab diesem Tag. So gibt es beim Einschalten **keine Flut
  alter Erinnerungen** für Kinder, die schon lange da sind: Bei „alle 12 Monate“ ist die Doku für sie erst 12 Monate
  nach dem Einschalten fällig, bei „um den Geburtstag“ am nächsten Geburtstag. Ein Kind, das später eintritt, zählt
  ab seinem Eintritt. Ändert ihr nur die Monate oder die Wochen vorher, bleibt „gilt seit“ gleich; beim Ausschalten
  wird es gelöscht, beim nächsten Einschalten neu gesetzt. Bei Gruppen, die vor diesem Update schon eingeschaltet
  waren, gilt der Tag des Updates.

  Ein verpasster Termin bleibt in beiden Fällen **rot als überfällig stehen, bis jemand „Erledigt“ tippt** – auch
  wenn der Geburtstag schon lange vorbei ist.

  Es gilt die Einstellung der Gruppe, in der das Kind **heute** ist. Wechselt ein Kind die Gruppe oder ändert sich
  die Einstellung, gilt das sofort.

Den **Geburtstag eines Mitarbeiters** (Tag und Monat, ohne Jahr) tragen Leitung und Träger freiwillig in den
Stammdaten unter *Mitarbeiter* ein. Wer am 29. Februar Geburtstag hat, wird in Nicht-Schaltjahren am 28. Februar
erinnert (bei Kindern ebenso).
