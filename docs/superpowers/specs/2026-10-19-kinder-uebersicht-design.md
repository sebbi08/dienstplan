# Übersicht der Kinder (wie die Excel-Liste)

Stand: 19.10.2026 · Baut auf Kinderakte (2026-10-08), Kinderakten nur am Tablet (2026-10-15), Gruppenbücher
(2026-10-16) und Einwilligungen (2026-10-19) auf. Vorlage: die Excel-Liste `Gruppenbuch1.xlsx` (Blätter Datenschutz,
WhatsApp, Gesundheit, Abholberechtigte, Sorgeberechtigte, Notfallkontakte, Telefonnummern).

## 1. Ziel

Ein neuer Reiter **„Übersicht“** unter „Kinder“ zeigt die Angaben aller Kinder als Tabellen, aufgebaut wie die Blätter
der Excel-Liste und ergänzt um die neuen Einwilligungen. Mitarbeiter sehen die Tabellen am Tablet, Leitung und Träger
auf jedem Gerät und können sie drucken. Es wird nichts neu erfasst: alle Werte kommen aus den Kinderakten.

| Entschieden | |
|---|---|
| Ort | Reiter „Übersicht“ unter „Kinder“, nach „Liste“. |
| Aufbau | Unterreiter: Datenschutz · Messenger · Gesundheit · Abholberechtigte · Sorgeberechtigte · Notfallkontakte · Telefonnummern. |
| Zeilen | Ein Kind je Zeile (Name, Vorname), nach Gruppen geordnet (wie die Liste), Gruppenauswahl wie bei der Liste. |
| Werte | Einwilligungen: ✓ ja (grün), ✗ nein (rot), – offen (grau). |
| Wer sieht was | Mitarbeiter am Tablet: eigene Gruppe + freigeschaltete Gruppen (wie die Akten); Leitung/Träger: alle. |
| Drucken | Leitung und Träger, je Unterreiter A4 quer; am Tablet kein Druck. |
| Welche Kinder | Die aktiven Kinder der Einrichtung, wie in der Liste (keine Vormerkungen, kein Archiv). |

## 2. Die Unterreiter

| Unterreiter | Spalten (Reihenfolge) |
|---|---|
| Datenschutz | Bastel-/Malarbeiten aufhängen · Einzel-/Gruppenfotos aufhängen · Fotoerlaubnis für fremde Portfolios · Fotos hausinterne Feste · Fotos, Namen, Geburtsdaten aufhängen · Gruppenarbeiten mit Namen ausstellen |
| Messenger | Kontaktaufnahme über WhatsApp · Fotos über WhatsApp · Fotos über Signal · WhatsApp-Elterngruppe |
| Gesundheit | Masern (Nachweis, mit Datum) · Belehrung Infektionsschutz (Datum) · Allergien (Text) · Fieber messen · Sonnenschutz · Pflaster kleben · Insektenschutz |
| Abholberechtigte | Alle Kontakte mit „darf abholen“ (ohne Umgangsverbot), je Name mit Beziehung, z. B. „Erika Muster (Oma)“ |
| Sorgeberechtigte | Sorgeberechtigte (Namen) · Kontaktverbot: Namen der Kontakte mit Umgangsverbot und Hinweis, rot hervorgehoben |
| Notfallkontakte | Notfallkontakte in ihrer Reihenfolge (1., 2., …), je Name, Beziehung und Telefonnummer(n) |
| Telefonnummern | Adresse · je Kontakt (in der Reihenfolge der Akte) Name, Beziehung und Telefon privat / mobil / Arbeit |

- Spaltenköpfe sind kurz; der volle Text steht als Hinweis am Kopf (antippen oder darüberfahren).
- Leere Angaben bleiben leer (keine „–“ bei Textfeldern).
- Der Name eines Kindes führt zur Akte (wie in der Liste), sofern die Person die Akte sehen darf.
- Kinder ohne Gruppe stehen am Ende („ohne Gruppe“).

## 3. Rechte und Sicherheit

- Die Übersicht nutzt dieselben Regeln wie die Kinderakten: Mitarbeiter nur am aufgeschlossenen Tablet; mit Gruppe nur
  die eigene und freigeschaltete Gruppen (nur lesen); ohne Gruppe, Aushilfen, Leitung und Träger alle Kinder.
- Der Server liefert nur die Kinder, die die Person sehen darf (keine Filterung erst im Browser).
- Telefonnummern und Kontaktverbote erscheinen nur für Kinder, deren Akte die Person lesen darf.

## 4. Drucken

- Leitung und Träger: je Unterreiter eine Druckseite A4 quer (Kopf: Einrichtung, Unterreiter, Gruppe bzw. „alle
  Gruppen“, Datum), über den vorhandenen PDF-Druck (`/print/children/…`). Am Tablet keine Druck-Knöpfe.

## 5. Technik (Überblick)

- Ein Lese-Endpunkt (`requireChildReader(`) liefert für die sichtbaren Kinder alle Werte der Unterreiter in einem
  Aufruf (Einwilligungen, Gesundheitsfelder, Kontakte mit Rollen und Telefonnummern, Adresse, Gruppe).
- Reiter mit Unterreitern, eine gemeinsame Tabellen-Komponente; Druckseite; Texte in `de.ts`; BETRIEB.md ergänzen.

## 6. Tests

- Sichtbarkeit: Mitarbeiter mit Gruppe A sieht nur A (+ freigeschaltete), Leitung alle, Mitarbeiter am Handy keine
  (Tablet-Sperre wie bei den Akten); Kinder ohne Gruppe für alle.
- Werte: Einwilligungen ja/nein/offen, Abholberechtigte ohne Kontakte mit Umgangsverbot, Notfallkontakte in Reihenfolge,
  Kontaktverbot mit Hinweis.
- Druck nur Leitung/Träger.

## 7. Nicht enthalten

- Bearbeiten in der Tabelle (geändert wird weiter in der Akte).
- Export als Excel-Datei.
