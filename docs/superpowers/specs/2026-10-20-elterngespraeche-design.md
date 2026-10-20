# Elterngespräche

Stand: 20.10.2026 · Baut auf Kinderakte (2026-10-08), Kinderakten nur am Tablet (2026-10-15), Übersicht der Kinder
(2026-10-19) und Erinnerungen (2026-10-19) auf.

## 1. Ziel

In der Kinderakte werden Elterngespräche mit Datum und Uhrzeit festgehalten (auch geplante). Eine Übersichtstabelle
zeigt alle Kinder mit allen Gesprächen und Gesprächsarten. Geplante Gespräche erscheinen am Tag selbst in den
Erinnerungen.

| Entschieden | |
|---|---|
| Ort | Abschnitt „Elterngespräche“ in der Kinderakte; Unterreiter „Elterngespräche“ in „Kinder → Übersicht“. |
| Ein Gespräch | Datum, Uhrzeit von (Pflicht) – bis (freiwillig), Art, Teilnehmer (freier Text), Notiz (freiwillig). |
| Arten | Entwicklungsgespräch, Eingewöhnung, Abschlussgespräch, Sonstiges. |
| Eintragen/Ändern/Löschen | Wer die Akte bearbeiten darf (Leitung, Träger, Mitarbeiter mit „Kinder bearbeiten“ am Tablet in der eigenen Gruppe). |
| Notiz | Vertraulich: nur Leitung und Träger sehen und schreiben sie; Mitarbeiter sehen Datum, Uhrzeit, Art, Teilnehmer. |
| Geplant | Ein Gespräch in der Zukunft ist „geplant“; am Tag selbst steht es im Kasten „Erinnerungen“. |

## 2. In der Kinderakte

- Abschnitt **„Elterngespräche“**: Liste, neueste zuerst; je Eintrag „‹TT.MM.JJJJ› ‹hh:mm›(–‹hh:mm›) · ‹Art› ·
  ‹Teilnehmer›“, geplante Gespräche mit dem Zusatz „geplant“; darunter klein „eingetragen von ‹Name› am ‹Datum›“
  (bzw. „geändert …“).
- **„Gespräch eintragen“**: Datum (Voreinstellung heute), Uhrzeit von, bis (freiwillig, nach „von“), Art (Auswahl),
  Teilnehmer, Notiz (nur für Leitung/Träger sichtbar und bearbeitbar).
- Ändern und Löschen (mit Rückfrage) für dieselben Personen. Jede Änderung im Verlauf der Akte wie bei den anderen
  Abschnitten.
- Prüfungen: gültiges Datum und Uhrzeit, „bis“ nach „von“ (sonst „Das Ende muss nach dem Beginn liegen.“), Art aus der
  Liste, Teilnehmer höchstens 200 Zeichen, Notiz höchstens 2000 Zeichen.

## 3. Übersichtstabelle

- Neuer Unterreiter **„Elterngespräche“** in „Kinder → Übersicht“ (nach „Telefonnummern“).
- Eine Zeile je Kind (wie die anderen Unterreiter, nach Gruppen geordnet), Spalten: **letztes Gespräch** (Datum, Art),
  **nächstes geplantes Gespräch** (Datum, Uhrzeit, Art), **alle Gespräche** (Liste „‹TT.MM.JJ› ‹Art›“, neueste
  zuerst), **Anzahl**.
- Ohne Notizen (vertraulich). Sichtbarkeit wie die anderen Unterreiter (eigene + freigeschaltete Gruppen; Leitung/Träger
  alle). Druck für Leitung/Träger wie die anderen Unterreiter.

## 4. Erinnerungen

- Ein geplantes Gespräch erscheint **am Tag selbst** im Kasten „Erinnerungen“: „Elterngespräch ‹Name› heute
  ‹hh:mm› (‹Art›)“, für dieselben Personen wie die anderen Kinder-Erinnerungen (eigene Gruppe; Leitung/Träger alle).
- Kein „Erledigt“ nötig: am Tag danach verschwindet es; das Gespräch gilt dann als stattgefunden (Eintrag bleibt).

## 5. Technik (Überblick)

- Neue Tabelle `child_parent_meetings` (Kind cascade, Datum, von, bis null, Art, Teilnehmer, Notiz, erstellt/geändert
  von/um). Notiz wird nur an Leitung/Träger ausgeliefert.
- Akten-DTO bekommt die Gespräche; Übersicht-DTO bekommt je Kind die Gespräche ohne Notiz; Erinnerungen bekommen die
  Art `meeting`.
- Rechte wie die übrigen Akten-Abschnitte (`requireChildEditor(` + Gruppenrecht).

## 6. Tests

- Anlegen/Ändern/Löschen mit Rechten (fremde Gruppe 403, nur lesbare Gruppe 403), Prüfungen.
- Notiz: Mitarbeiter bekommen sie nie (Akte, Übersicht), können sie nicht setzen; Leitung sieht und setzt sie.
- Übersicht: letztes/nächstes/alle/Anzahl; Sichtbarkeit.
- Erinnerung nur am Tag des geplanten Gesprächs.

## 7. Nicht enthalten

- Terminbuchung durch Eltern, Kalender-Einladungen, Protokoll-Vorlagen.
