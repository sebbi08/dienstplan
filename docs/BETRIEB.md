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

### Wer sieht was

| Rolle | Kinderakten |
|---|---|
| Träger und Leitung | sehen alles in ihrer (gewählten) Einrichtung: alle Kinder, auch vertrauliche Dokumente. Nur sie dürfen ein Kind abmelden, das Archiv sehen und Akten löschen. Das gilt im Büro und am Tablet. |
| Mitarbeiter | sehen die Kinder **nur am Tablet der eigenen Einrichtung**, und dort nur lesend: alle aktiven Kinder, Vormerkungen und künftige Vertragskinder nur, wenn die Schalter (siehe unten) an sind. Vertrauliche Dokumente öffnen sie nicht (Art und Datum sehen sie, den Titel nicht), und abgemeldete Kinder (Archiv) sehen sie nicht. Mit dem eigenen Konto (Handy, privater PC) sehen sie keine Kinder. |
| Mitarbeiter mit der Berechtigung „darf Kinderakten pflegen“ | dürfen am Tablet zusätzlich Kinder anlegen und bearbeiten, Dokumente hochladen und vertrauliche Dokumente öffnen. Abmelden, Archiv und Löschen bleiben der Leitung und dem Träger vorbehalten. |
| Aushilfen aus einer anderen Einrichtung | sehen die Kinder am Tablet nur an den Tagen, an denen sie dort eingeplant sind, und nur lesend. |

Die Berechtigung „darf Kinderakten pflegen“ vergibst du unter *Benutzer* pro Mitarbeiter. Sie gilt am Tablet
der Einrichtung.

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
- Oben steht, wie viele Kinder da, abgeholt, abwesend und noch nicht da sind, und wie viele beim Snack und
  beim Mittagessen dabei sind. Die Liste ist nach Gruppen geordnet (Kinder ohne Gruppe am Ende).
- **„Kommt“**: Uhrzeit (vorgeschlagen ist jetzt) und **geplante Abholzeit** (Pflicht). Vorgeschlagen wird das
  Ende der Betreuungszeit aus der Betreuungsform des Kindes. Ist unter *Einstellungen → Anwesenheit* „Bringperson
  erfassen“ an, fragt der Dialog zusätzlich, wer das Kind gebracht hat. Ein Kind, das schon abgeholt wurde, kann
  am selben Tag noch einmal kommen (z. B. nach einem Arzttermin).
- **„Geht“**: Uhrzeit (nicht vor der Ankunft) und **wer abholt**. Zur Auswahl stehen die Bezugspersonen mit
  „darf abholen“ und die Personen, die für diesen Tag angekündigt sind. Personen mit Umgangsverbot stehen nie in
  der Auswahl; hat das Kind ein Umgangsverbot, zeigt der Dialog den Hinweis aus der Akte in Rot.
- Holt jemand ab, der weder in der Akte steht noch angekündigt ist, tippst du auf **„Andere Person“**, gibst
  den Namen ein und – wenn es eine gab – mit wem das abgesprochen ist (**„Rücksprache mit“**, z. B. „Mama,
  telefonisch“). Der Name einer Person mit Umgangsverbot wird abgewiesen. In der Tagesliste, im Druck und im
  Verlauf steht danach „Name (nicht hinterlegt)“, so sieht man auch später, dass die Person nicht eingetragen war.
  Die „Rücksprache mit“ siehst du, wenn du mit der Maus auf dem Aufenthalt bleibst, beim „Zeiten korrigieren“ und
  im Druck unter Info. Auch beim „Zeiten korrigieren“ kannst du „Andere Person“ wählen.
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

### Snack und Mittagessen

Die Uhrzeiten stellen Leitung und Träger unter *Einstellungen → Anwesenheit* ein (voreingestellt 9:30 und
12:00). Ein Kind zählt für eine Mahlzeit, wenn es zu deren Uhrzeit da ist oder laut geplanter Abholzeit da sein
wird. Ein Tipp auf das Häkchen ändert das von Hand (z. B. „isst heute nicht mit“), der Pfeil daneben stellt
wieder auf automatisch.

### Infospalte

Rechts beim Kind stehen die **Allergien und Unverträglichkeiten** aus der Akte und das Feld **„Was ist heute
passiert“** für kurze Notizen über den Tag (z. B. „hingefallen, Knie gekühlt“), damit sie beim Abholen
weitergegeben werden. Andere Inhalte der Akte und vertrauliche Dokumente erscheinen hier nie.

### Monatsübersicht

Pro Gruppe eine Tabelle mit einer Zeile je Kind: ✓ da, K krank, U Urlaub, E entschuldigt, – unentschuldigt.
Grau sind Wochenenden, Feiertage und Schließtage; schraffiert sind Tage, an denen das Kind nicht in dieser Gruppe
(oder noch nicht bzw. nicht mehr in der Kita) war. Rechts stehen die Summen und eine **Bemerkung** pro Kind und
Monat. Ein Tipp auf eine Tageszahl öffnet diesen Tag.

### Drucken im Büro

Tagesliste und Monatsübersicht drucken Leitung und Träger im Büro mit **„Drucken“** (A4 quer, als Ausdruck oder
PDF). Am Tablet gibt es keine Druck-Knöpfe; dort ist die Liste jederzeit am Bildschirm zu sehen (z. B. bei einer
Räumung).

### Ändern und Verlauf

Alle Angaben lassen sich ändern, auch an älteren Tagen: Zeiten und Abholperson über den Stift am Aufenthalt
(ein versehentlich gestempelter Aufenthalt lässt sich dort auch löschen), die geplante Abholzeit und die Notiz
direkt in der Zeile. Jede Änderung wird mit Person und Uhrzeit festgehalten. Ein kleines Uhr-Symbol neben dem
Namen zeigt, dass ein Eintrag geändert wurde; ein Tipp darauf zeigt den Verlauf.
