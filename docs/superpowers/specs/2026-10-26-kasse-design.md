# Kasse (Kassenbuch je Kasse und Monat)

Stand: 26.10.2026 · Vorlage: „Kassenblatt blanko.xlsx“ (vom Träger bereitgestellt, nicht im Repository). Baut auf
Einrichtungen, Gruppen, Rollen (Leitung/Träger), Upload-Prüfung der Kinderakte (`server/lib/fileSignature.ts`), Menü
„Mehr“ und Datensicherung auf.

## 1. Ziel

Leitung und Träger führen die Kassen der Kita in der App statt in Excel: je Einrichtung und je Gruppe beliebig viele
Kassen (bar oder EC/Konto), je Monat ein Kassenblatt wie die Vorlage, mit Belegen, Umbuchungen, Monatsabschluss und
Protokoll. Ausdruck/PDF im Aufbau der Vorlage und eine Datei für Excel.

| Entschieden | |
|---|---|
| Wer | Leitung (eigene Einrichtung) und Träger (alle Einrichtungen); Mitarbeiter und Tablet: kein Zugriff. |
| Ausgabe | Ausdruck wie die Vorlage (auch „als PDF speichern“) **und** Datei für Excel (Monat oder Jahr). |
| Belege | Foto (JPG/PNG) oder PDF je Eintrag, freiwillig. |
| Umbuchung | Eigener Knopf; trägt Ausgabe und Einnahme in beiden Kassen ein, beide hängen zusammen. |
| Änderungen | Monat abschließen; nur der Träger öffnet wieder (mit Begründung); alles wird protokolliert. |
| Verwendungszweck | Freier Text mit Vorschlägen aus früheren Einträgen der Einrichtung; keine Kategorien. |
| Start | Je Kasse Startmonat + Anfangsbestand; frühere Monate bleiben in den Excel-Dateien (kein Import). |

## 2. Vorlage (was übernommen wird)

Ein Blatt je Kasse und Monat: Kopf „Kassenbuch“, „Kasse: ‹Name›“, „Monat/Jahr“, Anfangsbestand, Einnahmen (Summe),
Ausgaben (Summe), aktueller Kassenbestand = Anfangsbestand + Einnahmen − Ausgaben. Darunter zwei Spalten
„Einnahmen“ (Nr., Datum, Betrag) und „Ausgaben“ (Nr., Datum, Betrag), rechts „Verwendungszweck“, unten „Gesamt“.
Bisher wird der Anfangsbestand jeden Monat von Hand übertragen; in der App ist er der Endbestand des Vormonats.

## 3. Kassen

- Felder: Name (Pflicht, je Einrichtung eindeutig), Art **Bar** oder **EC/Konto**, Zuordnung **Einrichtung** oder
  **Gruppe** (eine Gruppe der Einrichtung), Startmonat, Anfangsbestand (darf 0 sein, nicht negativ), stillgelegt
  (ja/nein), Reihenfolge innerhalb der Zuordnung.
- Anlegen, umbenennen, Art/Zuordnung ändern, stilllegen und wieder aktivieren: Leitung und Träger. Startmonat und
  Anfangsbestand sind nur änderbar, solange der Startmonat nicht abgeschlossen ist.
- Löschen nur ohne Einträge; sonst nur stilllegen. Stillgelegte Kassen stehen eingeklappt am Ende der Übersicht, ihre
  Monate bleiben lesbar und druckbar; neue Einträge/Umbuchungen sind dort nicht möglich.
- Wird eine Gruppe gelöscht, die noch Kassen hat, wird das verhindert (Hinweis „Gruppe hat noch Kassen“).

## 4. Bildschirme

- **Menü:** neuer Punkt „Kasse“ (Leitung/Träger) unter „Mehr“ bzw. im Handy-Menü in derselben Gruppe.
- **Übersicht** (`/cash`): alle Kassen der aktiven Einrichtung, gegliedert nach „Einrichtung“ und den Gruppen (Reihenfolge
  der Gruppen); je Kasse Name, Art, aktueller Bestand (heute), Stand des Abschlusses („abgeschlossen bis September
  2026“), Zeichen „Belege fehlen“ wenn im offenen Zeitraum Ausgaben ohne Beleg sind. Knopf „Kasse anlegen“.
- **Monatsblatt** (`/cash/‹id›/‹Jahr›/‹Monat›`): Monatsauswahl (nicht vor dem Startmonat, nicht nach dem laufenden
  Monat), Kopf wie die Vorlage, Liste der Einträge nach Datum (Nr., Datum, Einnahme/Ausgabe, Betrag, Verwendungszweck,
  Beleg), Knöpfe „Einnahme“, „Ausgabe“, „Umbuchen“, „Monat abschließen“, „Drucken“, „Excel-Datei“ (Monat/Jahr);
  Protokoll aufklappbar. Handy: Karten statt Tabelle, keine seitliche Verschiebung bei 375 px.
- **Eintrag-Dialog:** Datum, Betrag (Komma oder Punkt, zwei Nachkommastellen), Verwendungszweck mit Vorschlägen,
  Beleg (Foto aufnehmen oder Datei wählen; ansehen; entfernen).
- **Umbuchen-Dialog:** von Kasse, an Kasse (nur andere, nicht stillgelegte Kassen derselben Einrichtung), Datum,
  Betrag, Verwendungszweck (vorbelegt „Umbuchung“), optional Beleg (gilt für beide Einträge).

## 5. Regeln

- **Beträge** in Cent (ganze Zahlen) gespeichert und gerechnet; Anzeige „1.234,56 €“.
- **Eintrag:** Datum im Monat des Blatts und nicht in der Zukunft, nicht vor dem Startmonat; Betrag > 0 und höchstens
  1.000.000,00 €; Verwendungszweck 1–200 Zeichen.
- **Nummern** werden nicht gespeichert, sondern beim Anzeigen vergeben: je Monat getrennt für Einnahmen und Ausgaben,
  sortiert nach Datum, dann nach Anlage-Reihenfolge. Nach dem Löschen rücken die übrigen nach.
- **Umbuchung:** erzeugt eine Ausgabe in der Quellkasse („Umbuchung an ‹Zielkasse›: ‹Text›“) und eine Einnahme in der
  Zielkasse („Umbuchung von ‹Quellkasse›: ‹Text›“) mit gemeinsamer Verknüpfung. Ändern (Datum, Betrag, Text, Beleg)
  und Löschen wirkt immer auf beide. Nur zwischen Kassen derselben Einrichtung, nur wenn der Monat des Datums in beiden
  Kassen offen ist und beide Kassen aktiv sind und das Datum in beiden nicht vor dem Startmonat liegt.
- **Bestand:** Anfangsbestand eines Monats = Anfangsbestand der Kasse + alle Einnahmen − alle Ausgaben vor diesem Monat.
  Barkasse unter 0 € am Monatsende oder an einem Tag → roter Hinweis „Kassenbestand negativ“; Speichern bleibt möglich.
  EC/Konto: kein Hinweis.
- **Abschluss:** Ein Monat kann abgeschlossen werden, wenn er vorbei ist (oder der laufende Monat ab seinem letzten
  Tag) und der Vormonat abgeschlossen ist (der Startmonat hat keinen Vormonat). Abgeschlossen = keine neuen, geänderten
  oder gelöschten Einträge mit Datum in diesem Monat, auch nicht über Umbuchungen, keine Änderung von Startmonat und
  Anfangsbestand. **Wieder öffnen** nur der Träger, Begründung Pflicht (1–200 Zeichen); damit werden auch alle späteren
  abgeschlossenen Monate dieser Kasse geöffnet.
- **Protokoll** je Kasse: Kasse angelegt/geändert/stillgelegt/aktiviert, Eintrag angelegt, geändert (vorher → nachher
  für Datum, Betrag, Text, Beleg), gelöscht, Umbuchung angelegt/geändert/gelöscht, Monat abgeschlossen, wieder geöffnet
  (Begründung) — jeweils mit Benutzername und Zeitpunkt. Das Protokoll kann niemand ändern oder löschen.
- **Belege:** JPG, PNG oder PDF, geprüft wie die Dokumente der Kinderakte (Dateiinhalt, Größengrenze). Gespeichert in der
  Datenbank, damit sie in der Datensicherung enthalten sind. Ansehen/Herunterladen nur mit Zugriff auf die Kasse.
- **Vorschläge** für den Verwendungszweck: die häufigsten Texte der Einrichtung, die zum Getippten passen (höchstens 8).

## 6. Rechte

| | Leitung | Träger | Mitarbeiter, Tablet |
|---|---|---|---|
| Kassen sehen, Einträge, Umbuchen, Belege | eigene Einrichtung | alle Einrichtungen (aktive Einrichtung) | – |
| Kassen anlegen/ändern/stilllegen/löschen | ja | ja | – |
| Monat abschließen | ja | ja | – |
| Monat wieder öffnen | – | ja | – |

Der Server prüft jede Anfrage (Rolle, Einrichtung der Kasse = aktive Einrichtung); Kassen anderer Einrichtungen sind
nicht sichtbar (404).

## 7. Ausdruck und Excel-Datei

- **Druckseite** je Kasse und Monat im Aufbau der Vorlage: Kopf mit Bestand, zwei Spalten Einnahmen/Ausgaben mit Nr.,
  Datum, Betrag und Verwendungszweck, „Gesamt“, Fußzeile „Gedruckt am … von …“ und „abgeschlossen am … von …“ bzw.
  „nicht abgeschlossen“. A4 hoch; über den Druckdialog als PDF speicherbar.
- **Excel-Datei** (CSV, Trennzeichen Semikolon, UTF-8 mit BOM, deutsches Zahlenformat mit Komma): Monat oder Kalenderjahr
  einer Kasse; Spalten Datum, Nr., Art (Einnahme/Ausgabe), Betrag, Verwendungszweck, Beleg (ja/nein), Bestand danach;
  Kopfzeilen mit Kasse, Zeitraum, Anfangs- und Endbestand. Dateiname „Kasse-‹Name›-‹JJJJ›-‹MM›.csv“ bzw. „…-‹JJJJ›.csv“.

## 8. Technik (Überblick)

- Tabellen: `cash_boxes` (Kassen), `cash_entries` (Einträge, Betrag in Cent, Richtung, Umbuchungs-Verknüpfung,
  Beleg-Verweis), `cash_receipts` (Beleg-Dateien), `cash_closed_months` (abgeschlossene Monate mit wer/wann),
  `cash_log` (Protokoll). Eine Migration `0054_cashbook`.
- Reine Rechenfunktionen in `shared/domain/cash*` (Bestand, Nummern, Monatsblatt, Abschluss-Regeln, CSV); Services in
  `server/services/cash*.ts`; Routen unter `/api/cash/…`.
- Datensicherung: die neuen Tabellen sind Teil der Datenbank-Sicherung (prüfen, dass die Sicherung alle Tabellen nimmt).
- Checkliste „Was noch fehlt“ und Warnungen bleiben unverändert (kein Kassen-Punkt).

## 9. Tests

- Rechnen auf den Cent: Anfangsbestand, Summen, Bestand, Übertrag über mehrere Monate, Startmonat.
- Nummern nach Datum, getrennt, Nachrücken nach dem Löschen.
- Umbuchung: beide Einträge entstehen, ändern sich und verschwinden gemeinsam; nicht in abgeschlossene Monate, nicht in
  stillgelegte oder fremde Kassen.
- Abschluss: Reihenfolge (Vormonat zuerst), Sperre aller Änderungen, Wieder-Öffnen nur Träger mit Begründung inklusive
  späterer Monate; Protokoll-Einträge.
- Rechte: Mitarbeiter/Tablet 403, Leitung sieht keine Kasse einer anderen Einrichtung, Leitung kann nicht öffnen.
- Belege: nur JPG/PNG/PDF, Größengrenze, Zugriff nur mit Recht auf die Kasse.
- CSV: Trennzeichen, Komma-Beträge, BOM, Bestand je Zeile.

## 10. Nicht enthalten

- Kategorien und Auswertungen je Kategorie; Import der bisherigen Excel-Dateien; Kassenzählung (Münzen/Scheine);
  Zugriff für Mitarbeiter; Abgleich mit Kontoauszügen.
