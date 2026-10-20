# Erinnerungen am Tablet (Entwicklungsdokumentation, Geburtstage, Abschied)

Stand: 19.10.2026 · Baut auf Kinderakte (2026-10-08), Kinderakten nur am Tablet (2026-10-15), Gruppenbücher
(2026-10-16) und Platzplanung/Schulkinder (2026-10-13) auf.

## 1. Ziel

Mitarbeiter werden am Tablet erinnert an
1. die **Entwicklungsdokumentation** jedes Kindes (je Gruppe einstellbar: in regelmäßigen Abständen oder um den
   Geburtstag), mit „Erledigt“;
2. **Geburtstage** der Kinder und der Mitarbeiter;
3. Kinder, die die **Einrichtung verlassen**.

Die Zeiträume legen Leitung und Träger fest. Keine Daten der Kinder auf den Handys der Mitarbeiter; auch die
Geburtstage der Mitarbeiter erscheinen nur am Tablet (und bei Leitung/Träger).

| Entschieden | |
|---|---|
| Ort | Kasten „Erinnerungen“ oben auf der Seite „Kinder“ (über den Reitern), am Tablet nach dem Aufschließen; Leitung/Träger auf jedem Gerät. |
| Wer sieht welche Kinder | Mitarbeiter mit Gruppe: Kinder der eigenen Gruppe (nicht der nur lesbar freigeschalteten); ohne Gruppe, Aushilfen: alle; Leitung/Träger: alle. |
| Mitarbeiter-Geburtstage | Alle Mitarbeiter der Einrichtung, für alle am Tablet sichtbar; nie auf den eigenen Handys. |
| Entwicklungsdoku | Je Gruppe: aus / alle X Monate / um den Geburtstag; Vorlauf in Wochen; „Erledigt“ antippen. |
| Geburtstage, Abschied | Je Einrichtung: Vorlauf in Tagen (Geburtstage) bzw. Wochen (Abschied). |

## 2. Entwicklungsdokumentation

### 2.1 Einstellung je Gruppe (Leitung und Träger)

In den Einstellungen bei jeder Gruppe „Entwicklungsdokumentation“:
- **aus** (Voreinstellung für bestehende Gruppen),
- **alle ‹X› Monate** (1–24),
- **um den Geburtstag**,
- dazu **„erinnern ‹W› Wochen vorher“** (0–12, Voreinstellung 2).

Kinder ohne Gruppe: es gilt eine Einstellung der Einrichtung mit denselben Möglichkeiten (Voreinstellung aus).

### 2.2 Fälligkeit

- Die App merkt sich je Gruppe (und für Kinder ohne Gruppe), **seit wann** die Erinnerung eingeschaltet ist bzw. die
  Art („alle X Monate“ / „um den Geburtstag“) zuletzt gewechselt wurde („gilt seit“). Ohne „Erledigt“ wird erst ab
  diesem Tag gezählt (keine Flut alter Erinnerungen beim Einschalten).
- **Alle X Monate**: fällig X Monate nach dem letzten „Erledigt“; ohne „Erledigt“ X Monate nach dem späteren von
  Eintritt (sonst geplanter Eintritt) und „gilt seit“.
- **Um den Geburtstag**: fällig am nächsten Geburtstag nach dem letzten „Erledigt“; ohne „Erledigt“ am ersten Geburtstag
  ab dem späteren von Eintritt und „gilt seit“. Wird innerhalb des Vorlaufs vor dem Geburtstag erledigt, gilt das für
  diesen Geburtstag.
- Ein verpasster Termin bleibt in beiden Fällen **rot als überfällig stehen, bis „Erledigt“** getippt wird.
  (Entschieden mit dem Träger am 20.10.2026.)
- Es zählt die Einstellung der **heutigen** Gruppe des Kindes. Wechselt die Einstellung, gilt die neue sofort.
- Angezeigt wird ab „fällig minus Vorlauf“; ab dem Fälligkeitstag rot als **überfällig**, bis erledigt.
- Nur aktive Kinder (keine Vormerkungen, keine Ausgetretenen).

### 2.3 Erledigt

- Am Eintrag „**Erledigt**“: speichert Datum und Person (auch die aufschließende Person am Tablet ohne Konto).
- Der Eintrag verschwindet bis zur nächsten Fälligkeit. „Rückgängig“: für Mitarbeiter am selben Tag (falls aus
  Versehen), für **Leitung und Träger jederzeit** (in der Kinderakte beim letzten „Erledigt“); danach gilt wieder das
  vorherige „Erledigt“ für die Fälligkeit.
- In der Kinderakte steht unter „Entwicklungsdokumentation“: zuletzt erledigt am ‹Datum› von ‹Name›, nächste Fälligkeit.
- Erledigen dürfen: wer das Kind in der eigenen Gruppe sieht (wie Eintragen in der Wochenübersicht), Leitung, Träger.
- Ist ein Bezugserzieher eingetragen und hat diese Person aufgeschlossen, steht beim Eintrag „dein Kind“.

## 3. Geburtstage

- **Kinder**: ab ‹T› Tagen vorher (Einrichtung, 0–30, Voreinstellung 7) „Lena wird am 12.11. 5 Jahre“; am Tag selbst
  hervorgehoben „Lena hat heute Geburtstag (5)“.
- **Mitarbeiter**: neues freiwilliges Feld **„Geburtstag“** (Tag und Monat, ohne Jahr) im Mitarbeiter-Eintrag, das
  Leitung und Träger pflegen. Ab ‹T› Tagen vorher (eigene Einstellung, Voreinstellung 7) „Anna hat am 12.11. Geburtstag“;
  am Tag hervorgehoben. Kein Alter. Ausgeschiedene Mitarbeiter nicht.
- 29. Februar: in Nicht-Schaltjahren am 28. Februar.

## 4. Abschied

- Kinder, deren Austritt bevorsteht: Austrittsdatum (abgemeldet), automatische Abmeldung der Schulkinder (Schulstart),
  Wechsel in eine andere Einrichtung (geplant). Ab ‹W› Wochen vorher (Einrichtung, 0–12, Voreinstellung 4)
  „Lena verlässt uns am 31.07.“ (bei Wechsel: „wechselt am … nach ‹Einrichtung›“), bis zum Tag.

## 5. Anzeige

- Kasten „Erinnerungen“ oben auf „Kinder“, aufklappbar (zu merkt sich das Gerät), sortiert: überfällig, heute, dann
  nach Datum. Je Eintrag Symbol (Doku, Geburtstag, Abschied), Text, Datum; bei Doku der Knopf „Erledigt“.
- Ohne Einträge: der Kasten zeigt „Keine Erinnerungen“ klein (oder bleibt weg — einfache Lösung).
- Der Name eines Kindes führt zur Akte, wenn die Person sie sehen darf.

## 6. Technik (Überblick)

- `groups`: `doc_mode` ('off' | 'interval' | 'birthday'), `doc_interval_months`, `doc_lead_weeks`; dieselben Felder auf
  `facilities` für Kinder ohne Gruppe; `facilities`: `birthday_lead_days`, `staff_birthday_lead_days`,
  `leaving_lead_weeks`.
- `employees.birthday` (`MM-DD`, null).
- Neue Tabelle `child_development_docs` (Kind cascade, erledigt am, von Benutzer/Mitarbeiter/Name).
- Reine Regeln in `shared/domain/reminders.ts` (Fälligkeit, Fenster, Sortierung); ein Lese-Endpunkt mit
  `requireChildReader(` und ein Endpunkt „Erledigt“ / „Rückgängig“ mit den Gruppenrechten; Einstellungen `requireAdmin(`.

## 7. Tests

- Fälligkeit Intervall (mit/ohne Erledigt, Eintritt/geplanter Eintritt), Geburtstag (vor/im/nach dem Vorlauf erledigt,
  29.02.), Gruppenwechsel, Einstellung aus.
- Sichtbarkeit: eigene Gruppe ja, nur lesbare Gruppe nein, Leitung alle; nichts am Handy der Mitarbeiter.
- Erledigt/Rückgängig: Rechte (fremde Gruppe 403), Rückgängig für Mitarbeiter nur am selben Tag, für Leitung/Träger
  jederzeit; danach zählt das vorherige „Erledigt“.
- Geburtstage Kinder und Mitarbeiter mit Vorlauf und am Tag; Abschied für Austritt, Schulkind, Wechsel.

## 8. Nicht enthalten

- Benachrichtigungen per E-Mail oder auf dem Handy.
- Hochladen der Entwicklungsdokumentation selbst (dafür gibt es die Dokumente der Akte).
