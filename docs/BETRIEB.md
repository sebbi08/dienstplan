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

Ohne HTTPS nur im lokalen Netz: `NUXT_SESSION_COOKIE_SECURE=false` setzen, in `docker-compose.yml`
bei `ports` die Zeile auf `"3000:3000"` ändern und nur `docker compose up -d --build` starten.

## 4. Update auf eine neue Version

```bash
cd /opt/dienstplan
# neue Projektdateien hierher kopieren, dann:
docker compose --profile https up -d --build
```

Die Daten bleiben erhalten; die Datenbank wird beim Start automatisch auf die neue Version gebracht.

## 5. Datensicherung

- **Automatisch:** Die App legt jede Nacht eine Kopie der Datenbank im Datenbereich unter `backups/` ab
  und behält die letzten 14 Tage.
- **Von Hand:** In der App unter *Einstellungen → Datensicherung → Datenbank herunterladen*.
- **Sicherungen vom Server holen** (z. B. auf einen anderen Rechner kopieren):

  ```bash
  docker compose cp dienstplan:/data/backups ./backups
  ```

Bewahre Sicherungen immer auch außerhalb des Servers auf.

## 6. Wiederherstellen einer Sicherung

```bash
docker compose stop dienstplan
docker compose cp ./dienstplan-2026-10-05.db dienstplan:/data/app.db
docker compose start dienstplan
```

## 7. Passwort des einzigen Admins vergessen

Ein anderer Admin kann unter *Benutzer* das Passwort zurücksetzen. Gibt es keinen weiteren Admin,
spiele die letzte Sicherung ein oder wende dich an die Person, die die App betreut.
