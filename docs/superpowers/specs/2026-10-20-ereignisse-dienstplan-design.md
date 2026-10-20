# Ereignisse im Dienstplan und Jahreskalender

Stand: 20.10.2026 · Baut auf Elterngespräche (2026-10-20), Erinnerungen (2026-10-19, Mitarbeiter-Geburtstag) und
Dienstplan/Jahreskalender auf.

## 1. Ziel

Der Dienstplan (Zeile „Info“ je Tag) und der Jahreskalender (Zeile „Termine“) zeigen automatisch:

| Ereignis | Text | Tag |
|---|---|---|
| Eingewöhnung | „Eingewöhnung (‹Gruppe›)“ | erster Tag eines neuen Kindes (Eintritt) |
| Elterngespräch | „Elterngespräch ‹hh:mm› (‹Gruppe›)“ | Tag des Gesprächs (geplant oder stattgefunden) |
| Kindergeburtstag | „Kindergeburtstag (‹Gruppe›)“ | Geburtstag eines aktiven Kindes |
| Mitarbeiter-Geburtstag | „Geburtstag ‹Name›“ | Geburtstag (Tag/Monat) eines nicht ausgeschiedenen Mitarbeiters |

- **Keine Kindernamen**, nur das Ereignis und die Gruppe (Gruppe des Kindes an dem Tag; ohne Gruppe: ohne Klammer).
- Mehrere gleiche Ereignisse am Tag werden zusammengefasst: „2× Kindergeburtstag (Bären)“, Elterngespräche je Uhrzeit.
- **Sichtbar überall**, wo Dienstplan und Jahreskalender heute sichtbar sind: Leitung/Träger, Mitarbeiter auf dem Handy
  („Mein Dienstplan“, „Mein Kalender“), Tablet. (Entschieden mit dem Träger am 20.10.2026: auch die
  Mitarbeiter-Geburtstage mit Namen überall; das ersetzt für Plan und Kalender die frühere Regel „nur am Tablet“.)
- Die Ereignisse werden **automatisch** erzeugt und sind nicht bearbeitbar; die eigenen Info-Einträge und Termine
  bleiben wie bisher und stehen davor.
- Im Druck von Dienstplan und Jahreskalender ebenso.

## 2. Abgrenzung

- Eingewöhnung = Eintrittsdatum (sonst kein Ereignis); Vormerkungen ohne Vertrag nicht.
- Kinder anderer Einrichtungen nicht; Kinder, die vor dem Tag ausgetreten sind, nicht.
- Freigabe-Vergleiche und Benachrichtigungen über Planänderungen berücksichtigen die automatischen Ereignisse nicht.

## 3. Technik (Überblick)

- Eine Funktion erzeugt für einen Zeitraum und eine Einrichtung die Ereignisse (ohne Kinder-Ids/-Namen im Ergebnis),
  die Dienstplan- und Kalender-DTOs bekommen ein Feld `autoEvents` je Tag.
- Kein neues Speichern, keine Migration.

## 4. Tests

- Je Ereignisart: richtiger Tag, Text, Gruppe des Tages; zusammengefasst; ausgetretene/fremde Kinder nicht.
- Kein Kindername und keine Kinder-Id in den DTOs (auch nicht für Mitarbeiter-Handys).
- Freigabe/Benachrichtigung unverändert.
